package id.ac.unklab.asrama.config;

import id.ac.unklab.asrama.common.DomainEnums.FacePose;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addFormatters(FormatterRegistry registry) {
        registry.addConverter(new Converter<String, FacePose>() {
            @Override
            public FacePose convert(String source) {
                return FacePose.from(source);
            }
        });
    }
}
