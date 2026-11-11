package id.ac.unklab.asrama.common;

/**
 * Utilitas perhitungan jarak geofence sisi server menggunakan rumus Haversine (K-06, P-11).
 * Seluruh perhitungan jarak dilakukan murni di backend (tidak mempercayai hitungan dari klien).
 */
public final class GeoUtils {

    // Radius rata-rata bumi dalam satuan meter
    private static final double EARTH_RADIUS_METERS = 6_371_000.0;

    // Batas toleransi akurasi GPS maksimal yang wajar (meter) untuk mencegah fake GPS / sinyal seluler kasar
    public static final double MAX_REASONABLE_ACCURACY_METERS = 150.0;

    private GeoUtils() {}

    /**
     * Menghitung jarak geodesic antara dua koordinat (latitude, longitude) dalam satuan meter menggunakan rumus Haversine.
     */
    public static double haversineDistanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double deltaPhi = Math.toRadians(lat2 - lat1);
        double deltaLambda = Math.toRadians(lon2 - lon1);

        double a = Math.sin(deltaPhi / 2.0) * Math.sin(deltaPhi / 2.0)
                + Math.cos(phi1) * Math.cos(phi2)
                * Math.sin(deltaLambda / 2.0) * Math.sin(deltaLambda / 2.0);

        double c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));

        return Math.round(EARTH_RADIUS_METERS * c * 100.0) / 100.0;
    }

    /**
     * Memvalidasi parameter koordinat dan akurasi GPS.
     */
    public static void validateGps(Double lat, Double lon, Double accuracyM, boolean required) {
        if (lat == null || lon == null) {
            if (required) {
                throw BusinessException.badRequest("GPS_LOCATION_REQUIRED",
                        "Koordinat GPS (latitude & longitude) wajib disertakan untuk sesi presensi ber-geofence.");
            }
            return;
        }

        if (lat < -90.0 || lat > 90.0) {
            throw BusinessException.badRequest("INVALID_LATITUDE", "Nilai latitude wajib berada di antara -90 dan 90");
        }
        if (lon < -180.0 || lon > 180.0) {
            throw BusinessException.badRequest("INVALID_LONGITUDE", "Nilai longitude wajib berada di antara -180 dan 180");
        }

        if (accuracyM != null) {
            if (accuracyM < 0) {
                throw BusinessException.badRequest("INVALID_GPS_ACCURACY", "Nilai akurasi GPS tidak boleh negatif");
            }
            if (accuracyM > MAX_REASONABLE_ACCURACY_METERS) {
                throw BusinessException.badRequest("GPS_ACCURACY_TOO_LOW",
                        String.format("Akurasi sinyal GPS perangkat Anda terlalu rendah (%.1fm). Maksimal toleransi %.0fm.",
                                accuracyM, MAX_REASONABLE_ACCURACY_METERS));
            }
        }
    }
}
