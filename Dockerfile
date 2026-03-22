# Railway / Docker: nightly scrapers (Python). Frontend stays on Vercel.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY scraper/requirements.txt /app/scraper/requirements.txt
RUN pip install --no-cache-dir -r /app/scraper/requirements.txt

COPY . /app

# Default: scrape on each container start (every deploy/restart). To avoid API use on deploy,
# set Railway variable RUN_SCRAPE_ON_START=0 and schedule Cron: bash scripts/nightly-scrape.sh
CMD ["bash", "scripts/railway-entry.sh"]
