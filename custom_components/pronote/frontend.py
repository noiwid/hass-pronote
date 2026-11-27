"""Embedded section-card (https://github.com/noiwid/section-card), loaded on every dashboard.

The card guards its own registration, so a section-card installed separately (HACS or resource) wins and
nothing is defined twice.
"""

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_FILE = Path(__file__).parent / "frontend" / "section-card.js"
_URL = f"/{DOMAIN}_frontend/section-card.js"
_SETUP_DONE = f"{DOMAIN}_frontend_setup"


async def async_setup_frontend(hass: HomeAssistant, version: str) -> None:
    """Serve the card and add it to the frontend, once."""
    if hass.data.get(_SETUP_DONE):
        return
    hass.data[_SETUP_DONE] = True
    await hass.http.async_register_static_paths([StaticPathConfig(_URL, str(_FILE), True)])
    add_extra_js_url(hass, f"{_URL}?v={version}")
