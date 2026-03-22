"""Load channels and spreadsheet config from channels.config.json."""
import json
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CONFIG_DIR.parent
CONFIG_PATH = PROJECT_ROOT / "channels.config.json"


def load_config():
    """Load channels.config.json from project root."""
    path = CONFIG_PATH
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_channels(config=None):
    """Return list of channel dicts (handle, name, niche, url)."""
    config = config or load_config()
    return config.get("channels", [])


def get_spreadsheet_id(config=None):
    """Return Google Spreadsheet ID."""
    config = config or load_config()
    return config["spreadsheetId"]


def get_sources_tab(config=None):
    """Return Sources sheet tab name."""
    config = config or load_config()
    return config.get("sourcesTab", "sheet")


def get_video_stats_tab(config=None):
    """Return VideoStatsRaw sheet tab name."""
    config = config or load_config()
    return config.get("videoStatsRawTab", "videostatsraw")


def get_channel_daily_tab(config=None):
    """Return Channel Daily sheet tab name."""
    config = config or load_config()
    return config.get("channelDailyTab", "channeldaily")
