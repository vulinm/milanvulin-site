FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY Api.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
RUN apk add --no-cache icu-libs tzdata krb5-libs
ARG GIT_SHA=dev
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false ASPNETCORE_HTTP_PORTS=8080 GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build /out .
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["dotnet", "Api.dll"]
