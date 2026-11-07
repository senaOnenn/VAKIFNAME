"""Windows'ta anahtar dosyası güvenlik denetimi (POSIX izin bitlerinin karşılığı).

Windows'ta `stat().st_mode` gerçek erişimi göstermez (çoğu dosya 0o666 görünür) ve `os.geteuid()` yoktur. Bu yüzden
dosyanın erişim listesi (DACL) ve sahibi Windows API'siyle (ctypes; ek paket yok) okunur:

- Sahip: geçerli kullanıcı, SYSTEM veya Administrators olmalı (POSIX'te "root veya servis hesabı" kuralının karşılığı).
- Okuma izni veren her ACE (izin veren erişim girdisi) yalnızca bu üç kimliğe veya OWNER RIGHTS'a (sahip) ait olabilir. Everyone, Users,
  Authenticated Users veya başka bir kullanıcıya okuma izni varsa anahtar reddedilir (POSIX'te grup/diğer okuma biti).
- Boş (NULL) DACL herkese tam erişim demektir: reddedilir. Yalnızca alt öğelere devredilen (INHERIT_ONLY) girdiler
  dosyanın kendisine uygulanmadığı için yok sayılır; reddeden (deny) girdiler erişimi yalnızca daraltır.
- Okunamayan bir güvenlik bilgisi veya tanınmayan izin veren girdi türü güvensiz sayılır (kapalı kalarak başarısız olur).

Kimlikler yerelleştirilmiş adlarla değil SID ile karşılaştırılır (Türkçe Windows'ta "Users" grubunun adı farklıdır).
"""

import ctypes
from ctypes import wintypes

SYSTEM_SID = "S-1-5-18"
ADMINISTRATORS_SID = "S-1-5-32-544"
# OWNER RIGHTS: "dosyanın sahibi" demektir; sahip aşağıda ayrıca güvenilir hesap olarak denetlendiği için güvenlidir
# (ör. pytest ve bazı araçlar sahibe özel dosyaları SYSTEM + Administrators + OWNER RIGHTS ile oluşturur).
OWNER_RIGHTS_SID = "S-1-3-4"

_SE_FILE_OBJECT = 1
_OWNER_SECURITY_INFORMATION = 0x00000001
_DACL_SECURITY_INFORMATION = 0x00000004
_ACL_SIZE_INFORMATION_CLASS = 2
_TOKEN_QUERY = 0x0008
_TOKEN_USER_CLASS = 1
_INHERIT_ONLY_ACE = 0x08
_ACCESS_ALLOWED_ACE_TYPE = 0x0
_ACCESS_DENIED_ACE_TYPE = 0x1
# Okuma veren haklar: FILE_READ_DATA (FILE_GENERIC_READ ve FILE_ALL_ACCESS bunu içerir), GENERIC_READ, GENERIC_ALL.
_READ_RIGHTS = 0x00000001 | 0x80000000 | 0x10000000


class _AclSizeInformation(ctypes.Structure):
    _fields_ = [("AceCount", wintypes.DWORD), ("AclBytesInUse", wintypes.DWORD), ("AclBytesFree", wintypes.DWORD)]


class _AceHeader(ctypes.Structure):
    _fields_ = [("AceType", ctypes.c_ubyte), ("AceFlags", ctypes.c_ubyte), ("AceSize", wintypes.WORD)]


class _AccessAllowedAce(ctypes.Structure):
    # ACCESS_ALLOWED_ACE ve ACCESS_DENIED_ACE aynı yerleşimdedir; SID `SidStart` alanının adresinden başlar.
    _fields_ = [("Header", _AceHeader), ("Mask", wintypes.DWORD), ("SidStart", wintypes.DWORD)]


def _api():
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32.GetNamedSecurityInfoW.argtypes = [
        wintypes.LPCWSTR, ctypes.c_int, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p)]
    advapi32.GetNamedSecurityInfoW.restype = wintypes.DWORD
    advapi32.GetAclInformation.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.c_int]
    advapi32.GetAclInformation.restype = wintypes.BOOL
    advapi32.GetAce.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    advapi32.GetAce.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
                                             ctypes.POINTER(wintypes.DWORD)]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    return advapi32, kernel32


def _sid_str(advapi32, kernel32, psid) -> str:
    out = wintypes.LPWSTR()
    if not advapi32.ConvertSidToStringSidW(psid, ctypes.byref(out)):
        raise OSError("ConvertSidToStringSidW")
    try:
        return out.value or ""
    finally:
        kernel32.LocalFree(ctypes.cast(out, ctypes.c_void_p))


def current_user_sid() -> str:
    advapi32, kernel32 = _api()
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), _TOKEN_QUERY, ctypes.byref(token)):
        raise OSError("OpenProcessToken")
    try:
        size = wintypes.DWORD()
        advapi32.GetTokenInformation(token, _TOKEN_USER_CLASS, None, 0, ctypes.byref(size))
        buf = ctypes.create_string_buffer(size.value)
        if not advapi32.GetTokenInformation(token, _TOKEN_USER_CLASS, buf, size, ctypes.byref(size)):
            raise OSError("GetTokenInformation")
        psid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p))[0]  # TOKEN_USER.User.Sid
        return _sid_str(advapi32, kernel32, psid)
    finally:
        kernel32.CloseHandle(token)


def private_to_current_user(path: str) -> bool:
    """Dosyanın sahibi ve okuma izni yalnızca geçerli kullanıcı, SYSTEM ve Administrators ise True. Hata: False."""
    try:
        advapi32, kernel32 = _api()
        trusted = {current_user_sid(), SYSTEM_SID, ADMINISTRATORS_SID}
        owner, dacl, sd = ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_void_p()
        rc = advapi32.GetNamedSecurityInfoW(str(path), _SE_FILE_OBJECT,
                                            _OWNER_SECURITY_INFORMATION | _DACL_SECURITY_INFORMATION,
                                            ctypes.byref(owner), None, ctypes.byref(dacl), None, ctypes.byref(sd))
        if rc != 0:
            return False
        try:
            if not owner.value or _sid_str(advapi32, kernel32, owner) not in trusted:
                return False
            if not dacl.value:  # NULL DACL: herkese tam erişim
                return False
            info = _AclSizeInformation()
            if not advapi32.GetAclInformation(dacl, ctypes.byref(info), ctypes.sizeof(info), _ACL_SIZE_INFORMATION_CLASS):
                return False
            for i in range(info.AceCount):
                pace = ctypes.c_void_p()
                if not advapi32.GetAce(dacl, i, ctypes.byref(pace)):
                    return False
                header = ctypes.cast(pace, ctypes.POINTER(_AceHeader)).contents
                if header.AceFlags & _INHERIT_ONLY_ACE or header.AceType == _ACCESS_DENIED_ACE_TYPE:
                    continue
                if header.AceType != _ACCESS_ALLOWED_ACE_TYPE:
                    return False  # nesne/geri çağırma türü izin girdileri: güvenli olduğu doğrulanamaz
                ace = ctypes.cast(pace, ctypes.POINTER(_AccessAllowedAce)).contents
                if not ace.Mask & _READ_RIGHTS:
                    continue
                psid = ctypes.c_void_p(pace.value + _AccessAllowedAce.SidStart.offset)
                if _sid_str(advapi32, kernel32, psid) not in trusted | {OWNER_RIGHTS_SID}:
                    return False
            return True
        finally:
            kernel32.LocalFree(sd)
    except (OSError, AttributeError, ValueError):
        return False
