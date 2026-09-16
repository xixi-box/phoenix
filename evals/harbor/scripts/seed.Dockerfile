# Throwaway image that seeds the benchmark database from the TRAIL rows.
# scripts/stage.sh builds it, copies /data/phoenix.db out, and never ships it:
# the raw rows must stay on the developer's machine.
FROM python:3.13-slim-bookworm
COPY wheels/ /wheels/
RUN pip install --no-cache-dir /wheels/*.whl
ENV PHOENIX_WORKING_DIR=/data \
    PHOENIX_TELEMETRY_ENABLED=false \
    PHOENIX_DISABLE_AGENT_ASSISTANT=true
ARG SEED_PROJECT=research-assistant
ENV SEED_PROJECT=${SEED_PROJECT}
COPY seed/ /seed/
RUN python /seed/seed.py
