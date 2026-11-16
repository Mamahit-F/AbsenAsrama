FROM maven:3.9-eclipse-temurin-17-alpine AS build
WORKDIR /app

COPY pom.xml .
RUN mvn -B dependency:go-offline

COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

COPY --from=build /app/target/*.jar app.jar

EXPOSE 8080

# Tuned for 512 MB free-tier containers (Render / Koyeb)
ENTRYPOINT ["sh", "-c", "java -XX:+UseSerialGC -Xms128m -Xmx320m -Dserver.port=${PORT:-8080} -jar app.jar"]
