package id.ac.unklab.asrama;

import jakarta.annotation.PostConstruct;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.io.BufferedReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.TimeZone;

@SpringBootApplication(exclude = {
        org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration.class
})
@ConfigurationPropertiesScan
@EnableScheduling
public class AsramaPresensiApplication {

    public static void main(String[] args) {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Makassar"));
        loadDotenvIfPresent();
        SpringApplication.run(AsramaPresensiApplication.class, args);
    }

    @PostConstruct
    public void initTimeZone() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Makassar"));
    }

    private static void loadDotenvIfPresent() {
        List<Path> candidates = List.of(
                Paths.get(".env"),
                Paths.get("../.env"),
                Paths.get("backend/.env"),
                Paths.get("../backend/.env")
        );
        for (Path path : candidates) {
            if (Files.exists(path) && Files.isRegularFile(path)) {
                try (BufferedReader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        line = line.trim();
                        if (line.isEmpty() || line.startsWith("#") || !line.contains("=")) {
                            continue;
                        }
                        int eqIdx = line.indexOf('=');
                        String key = line.substring(0, eqIdx).trim();
                        String value = line.substring(eqIdx + 1).trim();
                        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
                            value = value.substring(1, value.length() - 1);
                        }
                        if (System.getProperty(key) == null && System.getenv(key) == null) {
                            System.setProperty(key, value);
                        }
                    }
                    System.out.println("[AsramaPresensiApplication] Berhasil memuat variabel lingkungan lokal dari: " + path.toAbsolutePath());
                    break;
                } catch (Exception e) {
                    System.err.println("[AsramaPresensiApplication] Gagal membaca " + path + ": " + e.getMessage());
                }
            }
        }
    }
}
