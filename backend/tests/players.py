"""Oyun testlerinde oyuncular (R6.2: oyun yalnızca hesapla oynanır).

Her oyuncu gerçek bir hesaptır ve gerçek bir oturumu vardır (hesap deposu üzerinden açılır; kayıt ucunun istemci sınırına
takılmamak için). `PlayerClient`, istekteki `user_id` (sorgu, JSON gövdesi ya da `/users/{id}/…` yolu) bir oyuncuysa o
oyuncunun oturum çerezini gönderir; böylece bir testte birden çok oyuncu aynı istemciyle oynayabilir ve sunucudaki erişim
denetimi (`require_progress_access`) her istekte gerçekten çalışır. Oyuncu olmayan kimliklerde (misafir, başkasının hesabı)
istemcinin kendi çerezleri kullanılır.
"""

import re
import uuid

from fastapi.testclient import TestClient

from app.auth_routes import SESSION_COOKIE

PASSWORD = "Gizli-Parola-42"
_USERS_PATH = re.compile(r"/users/([^/?]+)/")


def _uid_of(url, kw) -> str | None:
    params = kw.get("params")
    if isinstance(params, dict) and params.get("user_id"):
        return str(params["user_id"])
    body = kw.get("json")
    if isinstance(body, dict) and body.get("user_id"):
        return str(body["user_id"])
    m = _USERS_PATH.search(str(url))
    return m.group(1) if m else None


class PlayerClient(TestClient):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.players: dict[str, str] = {}

    def request(self, method, url, **kwargs):
        token = self.players.get(_uid_of(url, kwargs) or "")
        if token and kwargs.get("cookies") is None:
            kwargs["cookies"] = {SESSION_COOKIE: token}
        return super().request(method, url, **kwargs)


def new_player(c: PlayerClient, email: str | None = None) -> str:
    """Yeni bir hesap açar, oturumunu bu istemciye bağlar ve hesap kimliğini (`u-…`) döndürür."""
    store = c.app.state.accounts
    user = store.create_user(email or f"oyuncu-{uuid.uuid4().hex[:12]}@example.com", PASSWORD)
    c.players[user["id"]] = store.create_session(user["id"], "password")
    return user["id"]
