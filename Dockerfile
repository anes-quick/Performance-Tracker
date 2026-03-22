# Railway / Docker: nightly scrapers (Python). Frontend stays on Vercel.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY scraper/requirements.txt /app/scraper/requirements.txt
RUN pip install --no-cache-dir -r /app/scraper/requirements.txt

COPY . /app

CMD ["bash", "scripts/nightly-scrape.sh"]
