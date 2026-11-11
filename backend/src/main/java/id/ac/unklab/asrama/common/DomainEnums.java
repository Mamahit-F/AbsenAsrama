package id.ac.unklab.asrama.common;

public final class DomainEnums {

    private DomainEnums() {}

    public enum UserRole {
        PENGHUNI,
        MONITOR,
        ADMIN,
        VILLAGE_DEAN
    }

    public enum ResidentStatus {
        AKTIF,
        NONAKTIF
    }

    public enum ResidenceCategory {
        ASRAMA,
        LUAR_DEKAT,
        LUAR_JAUH
    }

    public enum EnrollmentStatus {
        PENDING,
        PROCESSING,
        COMPLETED,
        FAILED
    }

    public enum FacePose {
        LURUS("front"),
        KIRI("left"),
        KANAN("right"),
        ATAS("up"),
        BAWAH("down");

        private final String filePrefix;

        FacePose(String filePrefix) {
            this.filePrefix = filePrefix;
        }

        public String getFilePrefix() {
            return filePrefix;
        }

        @com.fasterxml.jackson.annotation.JsonCreator
        public static FacePose from(String value) {
            if (value == null || value.isBlank()) {
                return null;
            }
            String normalized = value.trim().toUpperCase();
            return switch (normalized) {
                case "LURUS", "FRONTAL", "FRONT" -> LURUS;
                case "KIRI", "SLIGHT_LEFT", "LEFT" -> KIRI;
                case "KANAN", "SLIGHT_RIGHT", "RIGHT" -> KANAN;
                case "ATAS", "SLIGHT_UP", "UP" -> ATAS;
                case "BAWAH", "SLIGHT_DOWN", "DOWN" -> BAWAH;
                default -> FacePose.valueOf(normalized);
            };
        }
    }

    public enum ScheduleKind {
        ONE_TIME,
        RECURRING
    }

    public enum ScheduleStatus {
        ACTIVE,
        INACTIVE,
        CANCELLED
    }

    public enum SessionStatus {
        OPEN,
        CLOSED,
        CANCELLED
    }

    public enum AttendanceStatus {
        HADIR,
        TIDAK_HADIR
    }

    public enum AttendanceMethod {
        SCAN,
        MANUAL,
        DIBANTU_PENJAGA
    }

    public enum ValidationResult {
        SUCCESS,
        REJECTED
    }

    public enum ViolationStatus {
        ACTIVE,
        VOID
    }

    public enum ViolationSource {
        AUTO,
        MANUAL
    }

    public enum RequestType {
        PERMINTAAN_BANTUAN,
        LAPORAN_TINDAK_LANJUT
    }

    public enum CaseStatus {
        BARU,
        DIPROSES,
        SELESAI,
        DITUTUP
    }
}
