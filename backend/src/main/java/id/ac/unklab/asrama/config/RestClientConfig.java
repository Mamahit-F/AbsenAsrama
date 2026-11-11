package id.ac.unklab.asrama.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class RestClientConfig {

    @Bean
    public RestClient aiRestClient(AppProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(properties.ai().connectTimeoutMs());
        factory.setReadTimeout(properties.ai().readTimeoutMs());

        return RestClient.builder()
                .baseUrl(properties.ai().baseUrl())
                .requestFactory(factory)
                .defaultHeader("X-Internal-API-Key", properties.ai().apiKey())
                .build();
    }

    @Bean
    public RestClient storageRestClient(AppProperties properties) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(5000);

        return RestClient.builder()
                .baseUrl(properties.storage().supabaseUrl())
                .requestFactory(factory)
                .defaultHeader("apikey", properties.storage().serviceRoleKey())
                .defaultHeader("Authorization", "Bearer " + properties.storage().serviceRoleKey())
                .build();
    }
}
