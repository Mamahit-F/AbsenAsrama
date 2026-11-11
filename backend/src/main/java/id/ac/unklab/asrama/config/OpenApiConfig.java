package id.ac.unklab.asrama.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    public static final String BEARER_SECURITY_SCHEME = "bearerAuth";

    @Bean
    public OpenAPI asramaPresensiOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("Asrama Presensi UNKLAB Backend API")
                        .version("1.0.0")
                        .description("REST API Sistem Informasi Presensi Kegiatan Kerohanian Asrama & Luar Asrama Universitas Klabat (UNKLAB) " +
                                "(Spring Boot + Supabase PostgreSQL 17 + Custom JWT + RLS app_backend + FastAPI ArcFace AI)")
                        .contact(new Contact().name("Tim Pengembang Asrama Presensi UNKLAB")))
                .addSecurityItem(new SecurityRequirement().addList(BEARER_SECURITY_SCHEME))
                .components(new Components()
                        .addSecuritySchemes(BEARER_SECURITY_SCHEME,
                                new SecurityScheme()
                                        .name(BEARER_SECURITY_SCHEME)
                                        .type(SecurityScheme.Type.HTTP)
                                        .scheme("bearer")
                                        .bearerFormat("JWT")
                                        .description("Masukkan JWT Access Token dari endpoint /api/v1/auth/login")));
    }
}
