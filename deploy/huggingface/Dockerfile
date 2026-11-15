# The backend as a Hugging Face Space (free "Docker" Space).
#
# Same code as backend/Dockerfile. Three things differ, because a Space asks for them:
#   - it listens on port 7860
#   - it runs as a normal user (id 1000), not as root
#   - the height map is kept in /tmp/dem: a free Space has no disk that stays, so the file is
#     downloaded again from USGS each time the Space starts (about 10 MB, a few seconds)
#
# This file is not used from here. `deploy/make-space.sh` copies it, with the backend code,
# into one folder that is pushed to the Space.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEM_CACHE_DIR=/tmp/dem

# rasterio's bundled GDAL needs libexpat, which the slim image does not have.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user app ./app

EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
