"""Rehber için kanıt seçimi: yalnızca genel katalogdaki yayımlanmış olgular ve eser kimlik kayıtları.

Mevcut `app/ask` motorunun eser tanıma (ad, diğer adlar, belirsiz adlar) ve hibrit sıralamasını (yerel e5 + kelime)
kullanır. Eser belli ise o eserin bütün olguları (en çok 10) sıralanmış olarak verilir; böylece LLM birden fazla olguyu
birleştirebilir. Eser belli değilse bütün katalogda en ilgili `GLOBAL_K` olgu seçilir. Kitap metni, dahili RAG veya
yayımlanmamış kayıt kullanılmaz.
"""

from dataclasses import dataclass, field
from typing import Optional

from ..ask.engine import Doc, Engine

GLOBAL_K = 10
MAX_MONUMENTS = 3


@dataclass
class Evidence:
    status: str  # ok | clarify | not_in_catalog | empty
    monuments: list = field(default_factory=list)  # PublicMonument
    docs: list[Doc] = field(default_factory=list)
    options: list[dict] = field(default_factory=list)
    message: str = ""
    other_monument: Optional[str] = None
    interpreted: Optional[str] = None  # yazım düzeltmesiyle anlaşılan soru (okunur biçim); düzeltme yoksa None


def identity_id(monument_id: str) -> str:
    return f"{monument_id}-KIMLIK"


def identity_text(m) -> str:
    names = ", ".join([m.name, *m.alternative_names])
    return f"Adları: {names}. Türü: {m.type}. Konum: {m.district}, {m.city}. Adres: {m.address}."


def _rank(engine: Engine, query: str, docs: list[Doc]) -> list[Doc]:
    q = engine.corpus.analyzer.analyze(query)
    scored = engine._score(q, docs, engine._cosines(query))
    return [s.doc for s in scored]


def gather(engine: Engine, question: str, monument_id: Optional[str] = None, extra_query: str = "",
           candidate_ids: Optional[list[str]] = None) -> Evidence:
    """`extra_query`: fotoğraftan gözlenen özellikler gibi aramaya eklenecek metin (eser tanımada kullanılmaz).
    `candidate_ids`: fotoğraf analizinin önerdiği olası eserler (yalnızca tek ve açık bir eşleşme yoksa seçenek olur)."""
    c = engine.corpus
    if not c.docs:
        return Evidence("empty", message="Henüz yayımlanmış tarihî kayıt yok.")
    q = c.analyzer.analyze(question)
    # Yazım hatalı soru: sözlükte olmayan sözcükler düzeltilir. Düzeltilmiş soru yalnızca ham soruda tanınmayan bir eseri
    # tanıtıyorsa eser seçiminde kullanılır; sıralamada her zaman kullanılır (ham soru da sorgudadır).
    fix = c.correct(question)
    interpreted = None
    if fix.changed:
        q2 = c.analyzer.analyze(fix.text)
        if not q.monuments and (q2.monuments or (q2.other_monument and not q.other_monument)):
            q = q2
        question = f"{question} {fix.display}"
        interpreted = fix.display
    context = c.monuments.get(monument_id) if monument_id else None
    mids: list[str] = list(q.monuments)
    if not mids and q.other_monument:
        return Evidence("not_in_catalog", other_monument=q.other_monument, interpreted=interpreted,
                        message=f"“{q.other_monument}” henüz VAKIFNAME kataloğunda yayımlanmış eserler arasında değil.")
    if not mids and q.ambiguous:
        alias, amb, note = q.ambiguous
        if context and context.monument_id in amb:
            mids = [context.monument_id]
        else:
            return Evidence("clarify", options=_options(engine, amb), interpreted=interpreted,
                            message=note or f"“{alias}” adı birden fazla esere karşılık geliyor. Hangisini soruyorsunuz?")
    if not mids and context:
        mids = [context.monument_id]
    if not mids and candidate_ids:
        cands = [mid for mid in dict.fromkeys(candidate_ids) if mid in c.monuments]
        if len(cands) == 1:
            mids = cands
        elif cands:
            return Evidence("clarify", options=_options(engine, cands),
                            message="Fotoğraftaki yapı birden fazla esere benziyor. Hangisini soruyorsunuz?")
    query = f"{question} {extra_query}".strip()
    if mids:
        mids = mids[:MAX_MONUMENTS]
        docs = [d for d in c.docs if d.monument_id in mids]
        return Evidence("ok", monuments=[c.monuments[m] for m in mids], docs=_rank(engine, query, docs), interpreted=interpreted)
    ranked = _rank(engine, query, list(c.docs))[:GLOBAL_K]
    seen = list(dict.fromkeys(d.monument_id for d in ranked))
    return Evidence("ok", monuments=[c.monuments[m] for m in seen], docs=ranked, interpreted=interpreted)


def _options(engine: Engine, mids) -> list[dict]:
    return [{"monument_id": mid, "name": engine.corpus.monuments[mid].name} for mid in mids if mid in engine.corpus.monuments]
