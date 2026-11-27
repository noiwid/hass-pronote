"""Client wrapper for the Pronote integration."""

### Hotfix for python 3.13/3.14 https://github.com/bain3/pronotepy/pull/317#issuecomment-2523257656
import autoslot
import dis


def assignments_to_self(method) -> set:
    instance_var = next(iter(method.__code__.co_varnames), "self")
    instructions = list(dis.Bytecode(method))
    names = set()
    for i, inst in enumerate(instructions):
        if inst.opname == "STORE_ATTR" and i > 0:
            prev = instructions[i - 1]
            # Handle any LOAD_FAST variant (LOAD_FAST, LOAD_FAST_BORROW, etc.) or LOAD_DEREF
            is_load = "LOAD_FAST" in prev.opname or prev.opname == "LOAD_DEREF"
            if not is_load:
                continue
            if isinstance(prev.argval, tuple):
                # Combined instruction (e.g. LOAD_FAST_LOAD_FAST), self is in the tuple
                if instance_var in prev.argval:
                    names.add(inst.argval)
            elif prev.argval == instance_var:
                names.add(inst.argval)
    return names


autoslot.assignments_to_self = assignments_to_self
### End Hotfix

import pronotepy

### Hotfix for pronotepy 2.15.6 login on migrated PRONOTE instances
### https://github.com/delphiki/hass-pronote/issues/172
from . import pronotepy_hotfix  # noqa: F401
### End Hotfix

import json
import logging
import re
from datetime import datetime

from .pronote_formatter import information_answer, information_key, stable_key

_LOGGER = logging.getLogger(__name__)

# Errors meaning Pronote rejected auth and not just server failures :
# - wrong password
# - expired token
# - invalid PIN
class AuthenticationFailed(Exception):
    """Pronote did not log us in (wrong password or revoked token)."""


AUTH_ERRORS = (
    pronotepy.exceptions.CryptoError,
    pronotepy.exceptions.MFAError,
    AuthenticationFailed,
)


def get_pronote_server_version(client) -> str:
    """Return the PRONOTE version of the instance, e.g. "2026.2.5.7".

    Read from the ``Server`` header of the last response received, which every
    PRONOTE response carries. Unlike ``versionPN``, it is available even when
    the login itself failed, which is when it is the most useful. Returns
    "unknown" when the header is missing (a reverse proxy may strip it).
    """
    try:
        server = client.communication.last_response.headers.get("Server", "")
    except AttributeError:
        return "unknown"

    match = re.search(r"PRONOTE\s+([\d.]+)", server)
    return match.group(1) if match else "unknown"


def get_pronote_client(data) -> pronotepy.Client | pronotepy.ParentClient | None:
    _LOGGER.debug(f"Coordinator uses connection: {data['connection_type']}")

    if data["connection_type"] == "qrcode":
        client = get_client_from_qr_code(data)
    else:
        client = get_client_from_username_password(data)

    if client is None:
        _LOGGER.warning("Client creation failed")
        return None

    _LOGGER.debug("Connected to PRONOTE %s", get_pronote_server_version(client))

    try:
        client.session_check()
    except Exception as e:
        _LOGGER.error("Session check failed: %s", e)

    return client


def get_client_from_username_password(
    data,
) -> pronotepy.Client | pronotepy.ParentClient | None:
    url = data["url"].split("?", 1)[0]
    url = re.sub(r"/[^/]+\.html$", "/", url)
    if not url.endswith("/"):
        url += "/"
    url = url + ("parent" if data["account_type"] == "parent" else "eleve") + ".html"

    ent = None
    if "ent" in data:
        ent = getattr(pronotepy.ent, data["ent"])

    if not ent:
        url += "?login=true"

    try:
        client = (
            pronotepy.ParentClient
            if data["account_type"] == "parent"
            else pronotepy.Client
        )(
            pronote_url=url,
            username=data["username"],
            password=data["password"],
            account_pin=data.get("account_pin", None),
            device_name=data.get("device_name", None),
            client_identifier=data.get("client_identifier", None),
            ent=ent,
        )
        if not client.logged_in:
            raise AuthenticationFailed("username/password rejected")
        del ent
        del client.account_pin
        _LOGGER.info(client.info.name)
    except AUTH_ERRORS:
        raise
    except Exception as err:
        _LOGGER.critical(err)
        return None

    return client


def get_client_from_qr_code(data) -> pronotepy.Client | pronotepy.ParentClient | None:

    if "qr_code_json" in data:  # first login from QR Code JSON

        # login with qrcode json
        qr_code_json = json.loads(data["qr_code_json"])
        qr_code_pin = data["qr_code_pin"]
        uuid = data["qr_code_uuid"]

        # get the initial client using qr_code
        client = (
            pronotepy.ParentClient
            if data["account_type"] == "parent"
            else pronotepy.Client
        ).qrcode_login(
            qr_code=qr_code_json,
            pin=qr_code_pin,
            uuid=uuid,
            account_pin=data.get("account_pin", None),
            client_identifier=data.get("client_identifier", None),
            device_name=data.get("device_name", None),
        )

        qr_code_url = client.pronote_url
        qr_code_username = client.username
        qr_code_password = client.password
        qr_code_uuid = client.uuid
        qr_code_account_pin = client.account_pin
        qr_code_device_name = client.device_name
        qr_code_client_identifier = client.client_identifier
    else:
        qr_code_url = data["qr_code_url"]
        qr_code_username = data["qr_code_username"]
        qr_code_password = data["qr_code_password"]
        qr_code_uuid = data.get("uuid", data["qr_code_uuid"])
        qr_code_account_pin = data.get("account_pin", None)
        qr_code_device_name = data.get("device_name", None)
        qr_code_client_identifier = data.get("client_identifier", None)

    _LOGGER.info("Coordinator uses qr_code_username: %s", qr_code_username)

    client = (
        pronotepy.ParentClient if data["account_type"] == "parent" else pronotepy.Client
    ).token_login(
        pronote_url=qr_code_url,
        username=qr_code_username,
        password=qr_code_password,
        uuid=qr_code_uuid,
        account_pin=qr_code_account_pin,
        device_name=qr_code_device_name,
        client_identifier=qr_code_client_identifier,
    )
    if not client.logged_in:
        raise AuthenticationFailed("QR/token login rejected")
    return client


def get_day_start_at(lessons):
    day_start_at = None

    if lessons is not None:
        for lesson in lessons:
            if not lesson.canceled:
                day_start_at = lesson.start
                break

    return day_start_at


DISCUSSIONS_MAX = 10
DISCUSSION_MESSAGES_MIN = 3
MESSAGE_CONTENT_MAX = 4000


def fetch_discussions(client) -> list:
    """[(stable key, pronotepy discussion, its messages)], most recent first, without trash and drafts.

    Reading the messages does not mark them as read.
    """
    fetched = []
    discussions = [
        d for d in client.discussions() if not ({"Trash", "Drafts"} & set(d.labels))
    ][:DISCUSSIONS_MAX]
    for discussion in discussions:
        messages = discussion.messages
        first = messages[0].created if messages else None
        fetched.append(
            (stable_key(discussion.subject, discussion.creator, first), discussion, messages)
        )
    return sorted(
        fetched,
        key=lambda item: item[2][-1].created if item[2] else datetime.min,
        reverse=True,
    )


def format_discussions(fetched: list) -> list:
    """Plain dicts for the sensor. Every unread message is kept: marking as read marks the whole discussion."""
    result = []
    for key, discussion, messages in fetched:
        keep = max(DISCUSSION_MESSAGES_MIN, discussion.unread)
        result.append({
            "key": key,
            "subject": discussion.subject,
            "creator": discussion.creator,
            "unread": discussion.unread,
            "closed": discussion.closed,
            "last_date": messages[-1].created if messages else None,
            "message_count": len(messages),
            "messages": [
                {
                    "key": stable_key(key, message.created, message.author, (message.content or "")[:40]),
                    "author": message.author,
                    "date": message.created,
                    "seen": message.seen,
                    "content": (message.content or "")[:MESSAGE_CONTENT_MAX],
                }
                for message in messages[-keep:]
            ],
        })
    return result


def _raw_informations(client) -> dict:
    """{stable key: raw PRONOTE item} of the information tab: saving an item needs its own "public" field."""
    response = client.post(
        "PageActualites", 8, {"modesAffActus": {"_T": 26, "V": "[0..3]"}}
    )
    raws = {}
    for mode in response["dataSec"]["data"]["listeModesAff"]:
        for raw in mode["listeActualites"]["V"]:
            raws[information_key(pronotepy.dataClasses.Information(client, raw))] = raw
    return raws


def information_acknowledgments(client) -> dict:
    """{stable key: when the acknowledgment was given, or None}, from the information list.

    The detail of an information always reads "not answered" on a parent account:
    only the list ("informationListeContenu") tells who answered and when.
    """
    return {
        key: ((raw.get("informationListeContenu") or {}).get("reponduLe") or {}).get("V")
        for key, raw in _raw_informations(client).items()
    }


def mark_information(client, raw: dict, read: bool, acknowledge: bool = False) -> str:
    """SaisieActualites as the PRONOTE web client sends it. Returns "read", "unread" or "acknowledged".

    pronotepy's Information.mark_as_read lacks genreSaisie and estPublic and sends the wrong
    genrePublic: PRONOTE answers with a RapportSaisie error and changes nothing.
    Read and acknowledged are two separate states: the acknowledgment an information may expect
    is only given when acknowledge is set.
    """
    questions = []
    sent = "read" if read else "unread"
    already = (raw.get("informationListeContenu") or {}).get("reponduLe")
    if read and acknowledge and not already:
        information = pronotepy.dataClasses.Information(client, raw)
        information._fetch_content()
        answer = information_answer(information)
        if answer.get("estReponseAttendue"):
            question = information._raw_content[0]
            questions = [
                {
                    "N": question["N"],
                    "L": question.get("L", ""),
                    "E": 2,
                    "genreReponse": question["genreReponse"],
                    "reponse": {
                        "N": answer.get("N"),
                        "E": 2,
                        "valeurReponse": "",
                        "avecReponse": True,
                        "estReponseAttendue": True,
                    },
                }
            ]
            sent = "acknowledged"
    response = client.post(
        "SaisieActualites",
        8,
        {
            "genreSaisie": 0,
            "listeActualites": [
                {
                    "N": raw["N"],
                    "L": raw.get("L", ""),
                    "validationDirecte": True,
                    "genrePublic": raw.get("genrePublic", raw["public"]["V"]["G"]),
                    "public": raw["public"]["V"],
                    "estPublic": raw.get("estPublic"),
                    "lue": read,
                    "supprimee": False,
                    "marqueLueSeulement": not questions,
                    "saisieActualite": False,
                    "listeQuestions": questions,
                }
            ],
            "saisieActualite": False,
        },
    )
    if ((response.get("dataSec") or {}).get("RapportSaisie") or {}).get("_erreurSaisie_"):
        raise ValueError("PRONOTE refused the request")
    return sent


def apply_read_marks(client, marks: list, fetched_discussions: list) -> None:
    """Apply the marks queued by the pronote.mark_as_read service, one attempt each."""
    discussions = {key: discussion for key, discussion, _ in fetched_discussions}
    informations = None
    for mark in marks:
        kind, key, read = mark["kind"], mark["key"], mark["read"]
        try:
            if kind == "discussion":
                target = discussions.get(key)
                if target is None:
                    _LOGGER.warning("Pronote discussion %s not found, read mark dropped", key)
                    continue
                target.mark_as(read)
                sent = "read" if read else "unread"
            else:
                if informations is None:
                    informations = _raw_informations(client)
                raw = informations.get(key)
                if raw is None:
                    _LOGGER.warning("Pronote information %s not found, read mark dropped", key)
                    continue
                sent = mark_information(client, raw, read, mark.get("acknowledge", False))
            _LOGGER.debug("Pronote %s %s marked as %s", kind, key, sent)
        except pronotepy.exceptions.PronoteAPIError as ex:
            # pronotepy has logged in again: what was fetched before is stale, stop here
            _LOGGER.warning("Could not mark pronote %s %s, remaining read marks dropped: %s", kind, key, ex)
            break
        except Exception as ex:
            _LOGGER.warning(
                "Could not mark pronote %s %s as %s: %s", kind, key, "read" if read else "unread", ex
            )
