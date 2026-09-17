import re

from app.main import CORS_ORIGIN_REGEX


def test_cors_regex_allows_cloudflare_pages_preview_origins():
    assert re.match(CORS_ORIGIN_REGEX, "https://anix-hrms.pages.dev")
    assert re.match(CORS_ORIGIN_REGEX, "https://dc59f0d4.anix-hrms.pages.dev")


def test_cors_regex_rejects_unrelated_pages_origins():
    assert not re.match(CORS_ORIGIN_REGEX, "https://other-project.pages.dev")
