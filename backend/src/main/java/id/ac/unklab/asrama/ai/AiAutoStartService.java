package id.ac.unklab.asrama.ai;

import id.ac.unklab.asrama.config.AppProperties;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Mengelola pemulihan otomatis (auto-start & watchdog) layanan AI FastAPI lokal
 * ketika terdeteksi offline atau belum berjalan.
 */
@Service
public class AiAutoStartService {

    private static final Logger log = LoggerFactory.getLogger(AiAutoStartService.class);
    private static final Duration RELAUNCH_COOLDOWN = Duration.ofSeconds(25);
    private static final Set<String> LOCAL_HOSTS = Set.of("localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0");

    private final AppProperties appProperties;
    private final boolean autoStartEnabled;
    private final String pythonCommand;
    private final String configuredWorkingDir;

    private final Object launchMonitor = new Object();
    private final AtomicBoolean starting = new AtomicBoolean(false);
    private volatile Process managedProcess;
    private volatile Instant lastLaunchAttempt = Instant.EPOCH;

    public AiAutoStartService(
            AppProperties appProperties,
            @Value("${app.ai.auto-start:true}") boolean autoStartEnabled,
            @Value("${app.ai.python-command:python}") String pythonCommand,
            @Value("${app.ai.working-dir:}") String configuredWorkingDir
    ) {
        this.appProperties = appProperties;
        this.autoStartEnabled = autoStartEnabled;
        this.pythonCommand = pythonCommand;
        this.configuredWorkingDir = configuredWorkingDir;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ensureStartedOnBoot() {
        if (!autoStartEnabled) {
            return;
        }
        if (!isHealthEndpointReachable()) {
            log.info("Layanan AI belum aktif saat startup backend. Memicu auto-start AI Service...");
            triggerStartIfOffline();
        }
    }

    @Scheduled(
            fixedDelayString = "${app.ai.watchdog-interval-ms:15000}",
            initialDelayString = "${app.ai.watchdog-interval-ms:15000}"
    )
    public void watchdogCheck() {
        if (!autoStartEnabled || !isLocalBaseUrl()) {
            return;
        }
        if (!isHealthEndpointReachable()) {
            triggerStartIfOffline();
        }
    }

    /**
     * Memicu start AI Service secara asinkron jika target lokal dan sedang tidak sehat.
     *
     * @return true jika auto-start sedang berjalan atau baru dipicu, false jika dinonaktifkan/remote
     */
    public boolean triggerStartIfOffline() {
        if (!autoStartEnabled || !isLocalBaseUrl()) {
            return false;
        }
        if (isHealthEndpointReachable()) {
            starting.set(false);
            return false;
        }

        synchronized (launchMonitor) {
            if (isHealthEndpointReachable()) {
                starting.set(false);
                return false;
            }
            if (starting.get()) {
                return true;
            }
            Instant now = Instant.now();
            if (managedProcess != null && managedProcess.isAlive()
                    && Duration.between(lastLaunchAttempt, now).compareTo(RELAUNCH_COOLDOWN) < 0) {
                return true;
            }
            if (isTcpPortOpen(resolveTargetHost(), resolveTargetPort())) {
                // Proses lain sudah membuka port dan kemungkinan masih memuat model DeepFace
                return true;
            }

            starting.set(true);
            lastLaunchAttempt = now;
        }

        Thread starter = new Thread(this::launchAndAwaitReady, "ai-service-autostart");
        starter.setDaemon(true);
        starter.start();
        return true;
    }

    public boolean isStarting() {
        if (starting.get()) {
            return true;
        }
        Process proc = managedProcess;
        return proc != null
                && proc.isAlive()
                && Duration.between(lastLaunchAttempt, Instant.now()).compareTo(Duration.ofSeconds(35)) < 0;
    }

    private void launchAndAwaitReady() {
        try {
            Path aiDir = resolveAiServiceDir();
            if (aiDir == null) {
                log.warn("Auto-start AI dibatalkan: folder ai_service/main.py tidak ditemukan.");
                return;
            }

            String pythonExec = resolvePythonExecutable(aiDir);
            int port = resolveTargetPort();

            ProcessBuilder pb = new ProcessBuilder(
                    pythonExec,
                    "-m", "uvicorn",
                    "main:app",
                    "--host", "127.0.0.1",
                    "--port", String.valueOf(port)
            );
            pb.directory(aiDir.toFile());
            pb.redirectErrorStream(true);
            File logFile = aiDir.resolve("ai-service-auto.log").toFile();
            pb.redirectOutput(ProcessBuilder.Redirect.appendTo(logFile));

            log.info("Menjalankan AI Service otomatis: dir={}, cmd={} -m uvicorn main:app --host 127.0.0.1 --port {}",
                    aiDir, pythonExec, port);

            Process proc = pb.start();
            managedProcess = proc;

            // Tunggu hingga /health merespons 2xx atau proses berhenti
            for (int attempt = 0; attempt < 30; attempt++) {
                if (!proc.isAlive()) {
                    log.error("AI Service berhenti tak terduga dengan exit code {}. Periksa {}",
                            proc.exitValue(), logFile.getAbsolutePath());
                    return;
                }
                if (isHealthEndpointReachable()) {
                    log.info("AI Service otomatis ONLINE dan siap pada port {}.", port);
                    return;
                }
                Thread.sleep(1000);
            }
            log.warn("AI Service sudah dijalankan tetapi belum merespons /health dalam 30 detik. Cek {}",
                    logFile.getAbsolutePath());
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        } catch (IOException ex) {
            log.error("Gagal menjalankan proses AI Service otomatis: {}", ex.getMessage());
        } finally {
            starting.set(false);
        }
    }

    private boolean isLocalBaseUrl() {
        String host = resolveTargetHost();
        return host != null && LOCAL_HOSTS.contains(host.toLowerCase(Locale.ROOT));
    }

    private String resolveTargetHost() {
        try {
            URI uri = URI.create(appProperties.ai().baseUrl());
            return uri.getHost();
        } catch (Exception ignored) {
            return null;
        }
    }

    private int resolveTargetPort() {
        try {
            URI uri = URI.create(appProperties.ai().baseUrl());
            int port = uri.getPort();
            if (port > 0) {
                return port;
            }
            return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 8000;
        } catch (Exception ignored) {
            return 8000;
        }
    }

    private boolean isHealthEndpointReachable() {
        HttpURLConnection conn = null;
        try {
            String base = appProperties.ai().baseUrl();
            String url = base.endsWith("/") ? base + "health" : base + "/health";
            conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(800);
            conn.setReadTimeout(1200);
            int code = conn.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static boolean isTcpPortOpen(String host, int port) {
        if (host == null || port <= 0) {
            return false;
        }
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 300);
            return true;
        } catch (IOException ignored) {
            return false;
        }
    }

    private Path resolveAiServiceDir() {
        List<Path> candidates = configuredWorkingDir != null && !configuredWorkingDir.isBlank()
                ? List.of(Paths.get(configuredWorkingDir), Paths.get("ai_service"), Paths.get("../ai_service"), Paths.get("../../ai_service"))
                : List.of(Paths.get("ai_service"), Paths.get("../ai_service"), Paths.get("../../ai_service"));

        for (Path candidate : candidates) {
            Path normalized = candidate.toAbsolutePath().normalize();
            if (Files.isDirectory(normalized) && Files.isRegularFile(normalized.resolve("main.py"))) {
                return normalized;
            }
        }
        return null;
    }

    private String resolvePythonExecutable(Path aiDir) {
        List<Path> venvCandidates = List.of(
                aiDir.resolve(".venv/Scripts/python.exe"),
                aiDir.resolve(".venv/bin/python"),
                aiDir.resolve("venv/Scripts/python.exe"),
                aiDir.resolve("venv/bin/python")
        );
        for (Path venvPython : venvCandidates) {
            if (Files.isRegularFile(venvPython)) {
                return venvPython.toAbsolutePath().toString();
            }
        }
        return (pythonCommand == null || pythonCommand.isBlank()) ? "python" : pythonCommand.trim();
    }

    @PreDestroy
    public void shutdownManagedProcess() {
        Process proc = managedProcess;
        if (proc != null && proc.isAlive()) {
            log.info("Menghentikan AI Service yang dikelola backend...");
            proc.descendants().forEach(ProcessHandle::destroy);
            proc.destroy();
        }
    }
}
