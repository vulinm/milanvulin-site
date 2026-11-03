# Not an application: a delivery box for the deployment files.
# The server pulls it like any other image and copies the files out.
FROM scratch
COPY compose.yaml compose.platform.yaml compose.llm.yaml .env.example /deploy/
