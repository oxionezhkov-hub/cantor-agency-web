#!/usr/bin/env python3
"""Личные сайты участников МБА «Личный бренд» в трёх шаблонах Анны Алёшиной.

  python3 .claude/skills/mba-site/build.py <slug> [<slug> ...]   # или --all

Вход:  .claude/skills/mba-site/content/<slug>.json  (наполнение, см. SKILL.md)
Шаблон: client/anna-aleshina1 (дизайн А), anna-aleshina2 (Б), anna-aleshina3 (В) —
        из шаблона берутся <head>/<style> и <script>, разметка собирается здесь.
Выход: client/<slug> (страница без расширения) и client/images/<slug>/*.jpg.

Картинки — `images` в content: {слот: [имена исходников]}. Исходники лежат вне git
(папка из MBA_SRC, по умолчанию .claude/skills/mba-site/src/<slug>/); без исходника
сборка оставляет уже сжатую client/images/<slug>/<слот>-<n>.jpg.
"""
import html, json, os, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SKILL = Path(__file__).resolve().parent
CLIENT = ROOT / 'client'
TPL = {1: CLIENT / 'anna-aleshina1', 2: CLIENT / 'anna-aleshina2', 3: CLIENT / 'anna-aleshina3'}

def e(s):
    return html.escape(str(s or ''), quote=True)

def rich(s):
    """Escape, keep *курсив* as <em>, \n\n → paragraphs handled by caller."""
    t = e(s)
    t = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', t)
    return t

def paras(s, cls):
    return ''.join(f'<p class="{cls}">{rich(p.strip())}</p>' for p in str(s or '').split('\n\n') if p.strip())

ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
OUT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17L17 7M8 7h9v9"/></svg>'
PLAY = '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>'
CHEV_L = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>'
CHEV_R = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
ICONS = {
    'telegram': '<path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9-4.7-1.5c-1-.3-1-1 .2-1.5L20.5 3c.8-.3 1.6.2 1.4 1.3z"/>',
    'vk': '<path d="M12.8 17.5c-5.5 0-8.6-3.8-8.8-10h2.8c.1 4.6 2.1 6.5 3.7 6.9V7.5h2.6v3.9c1.6-.2 3.3-2 3.8-3.9h2.6c-.4 2.4-2.2 4.2-3.4 4.9 1.2.6 3.2 2.1 4 5.1h-2.9c-.6-1.9-2.2-3.4-4.1-3.6v3.6h-.3z"/>',
    'whatsapp': '<path d="M12 2.2a9.7 9.7 0 0 0-8.3 14.7L2.3 21.8l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2c0 1.2.9 2.3 1 2.5.1.2 1.7 2.6 4.2 3.7 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.5-.4z"/>',
    'youtube': '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/>',
    'phone': '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/>',
    'mail': '<path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v.4l8 5 8-5V7H4zm16 2.8-7.5 4.7a1 1 0 0 1-1 0L4 9.8V17h16V9.8z"/>',
    'max': '<path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.8 21l4.4-1.1A9.5 9.5 0 1 0 12 2.5zm3.9 13.1h-1.8v-4.4l-2.1 3h-.1l-2.1-3v4.4H8V8.4h1.7l2.3 3.4 2.3-3.4h1.7v7.2z"/>',
    'site': '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6C8.9 5.5 8.4 6.7 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.2 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z"/>',
    'profi': '<path d="M5 3h9a6 6 0 0 1 0 12H9v6H5V3zm4 4v4h5a2 2 0 0 0 0-4H9z"/>',
    'avito': '<circle cx="7" cy="16" r="4"/><circle cx="16.5" cy="7.5" r="3"/><circle cx="17" cy="17" r="2.2"/><circle cx="7.5" cy="6.5" r="1.8"/>',
    'instagram': '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zM17.3 5.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM12 3.8c2.7 0 3 0 4 .1 2.7.1 4 1.4 4.1 4.1.1 1 .1 1.4.1 4s0 3-.1 4c-.1 2.7-1.4 4-4.1 4.1-1 .1-1.4.1-4 .1s-3 0-4-.1c-2.7-.1-4-1.4-4.1-4.1-.1-1-.1-1.4-.1-4s0-3 .1-4C4 5.3 5.3 4 8 3.9c1-.1 1.3-.1 4-.1z"/>',
    'facebook': '<path d="M13.5 21v-8h2.7l.4-3.2h-3.1v-2c0-.9.3-1.5 1.6-1.5h1.6V3.4c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.4H7.6V13h2.7v8h3.2z"/>',
    'rutube': '<path d="M5 4h9.5a4.5 4.5 0 0 1 1.6 8.7L19 20h-4.3l-2.5-6.8H9V20H5V4zm4 3.6v2.8h5a1.4 1.4 0 0 0 0-2.8H9z"/>',
    'map': '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>',
}

def icon(kind, size=22):
    p = ICONS.get(kind, ICONS['site'])
    return f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{p}</svg>'

def social(it):
    href = it.get('href') or ''
    ext = href.startswith('http')
    tag = 'a' if href else 'div'
    attrs = f' href="{e(href)}"' + (' target="_blank" rel="noopener"' if ext else '') if href else ''
    tail = OUT if href else ''
    return (f'<{tag} class="social"{attrs}><span class="social-ic">{icon(it.get("kind","site"))}</span>'
            f'<span><strong>{e(it.get("label"))}</strong><span>{e(it.get("sub"))}</span></span>{tail}</{tag}>')

# ---------- images ----------

def prep_images(c):
    """Resize the picked source images into client/images/<slug>/ and return {slot: [{src, cap}]}."""
    from PIL import Image, ImageOps
    slug = c['slug']
    out_dir = CLIENT / 'images' / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    res = {}
    for slot, items in (c.get('images') or {}).items():
        res[slot] = []
        for n, it in enumerate(items, 1):
            if isinstance(it, str):
                it = {'src': it}
            src = Path(os.environ.get('MBA_SRC', SKILL / 'src')) / slug / it['src']
            name = f'{slot}-{n}.jpg'
            dst = out_dir / name
            if src.exists() and (not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime):
                im = ImageOps.exif_transpose(Image.open(src))
                if im.mode in ('RGBA', 'LA', 'P'):
                    im = im.convert('RGBA')
                    bg = Image.new('RGB', im.size, (255, 255, 255))
                    bg.paste(im, mask=im.split()[-1])
                    im = bg
                else:
                    im = im.convert('RGB')
                lim = 1000 if slot in ('reviews', 'logo', 'diplomas', 'results', 'books') else 1600
                im.thumbnail((lim, lim))
                im.save(dst, quality=82, optimize=True, progressive=True)
            res[slot].append({'src': f'images/{slug}/{name}', 'cap': it.get('cap', ''), 'alt': it.get('alt', '')})
    return res

def pod_posters(c):
    """Vimeo thumbnails for the podcasts, cached into client/images/<slug>/pod-<id>.jpg."""
    out = []
    for p in c.get('podcasts') or []:
        vid = str(p['vimeo'])
        dst = CLIENT / 'images' / c['slug'] / f'pod-{vid}.jpg'
        if not dst.exists():
            try:
                meta = json.load(urllib.request.urlopen(f'https://vimeo.com/api/oembed.json?url=https://vimeo.com/{vid}&width=1280', timeout=30))
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(urllib.request.urlopen(meta['thumbnail_url'], timeout=30).read())
            except Exception as ex:  # no poster: the box still plays
                print('  ! poster', vid, ex)
        out.append({**p, 'poster': f'images/{c["slug"]}/pod-{vid}.jpg' if dst.exists() else ''})
    return out

# ---------- blocks ----------

def nums_html(items, d):
    if not items:
        return ''
    if d == 1:
        cells = ''.join(f'<div class="tile x-stat rv"><div class="big-num{" x-long" if len(str(i["value"])) > 9 else ""}">{e(i["value"])}</div><p>{rich(i["label"])}</p></div>' for i in items)
        return f'<div class="x-stats">{cells}</div>'
    cls = 'nums x-nums'
    return f'<div class="{cls}">' + ''.join(f'<div class="num rv"><div class="num-v{" x-long" if len(str(i["value"])) > 9 else ""}">{e(i["value"])}</div><p>{rich(i["label"])}</p></div>' for i in items) + '</div>'

def cards_html(items):
    out = []
    for i in items:
        meta = f'<span class="x-meta">{e(i["meta"])}</span>' if i.get('meta') else ''
        res = f'<span class="x-res">{e(i["result"])}</span>' if i.get('result') else ''
        link = f'<a class="x-more" href="{e(i["href"])}" target="_blank" rel="noopener">{e(i.get("linkText") or "Подробнее")} {OUT}</a>' if i.get('href') else ''
        out.append(f'<article class="x-card rv">{meta}<h3>{rich(i.get("title"))}</h3>{paras(i.get("text"), "x-p")}{res}{link}</article>')
    return '<div class="x-cards">' + ''.join(out) + '</div>'

def steps_html(b):
    t = f'<h3 class="x-h3">{rich(b["title"])}</h3>' if b.get('title') else ''
    li = ''.join(f'<li class="rv"><span class="x-n">{n:02d}</span><div><strong>{rich(i.get("title"))}</strong><span>{rich(i.get("text"))}</span></div></li>' for n, i in enumerate(b['items'], 1))
    return f'<div class="x-steps-wrap">{t}<ol class="x-steps">{li}</ol></div>'

def list_html(b):
    t = f'<h3 class="x-h3">{rich(b["title"])}</h3>' if b.get('title') else ''
    cls = 'x-list x-neg' if b.get('negative') else 'x-list'
    return t + f'<ul class="{cls}">' + ''.join(f'<li>{rich(i if isinstance(i,str) else i.get("text"))}</li>' for i in b['items']) + '</ul>'

def quote_html(b):
    a = f'<cite>{e(b["author"])}</cite>' if b.get('author') else ''
    return f'<blockquote class="x-quote"><p>{rich(b["text"])}</p>{a}</blockquote>'

def links_html(items):
    return '<div class="socials x-links">' + ''.join(social(i) for i in items) + '</div>'

def gallery_html(imgs, group, cls='x-gallery'):
    if not imgs:
        return ''
    out = []
    for im in imgs:
        cap = im.get('cap') or ''
        out.append(f'<a class="x-shot rv" href="{e(im["src"])}" data-lb="{group}" data-caption="{e(cap)}"><img src="{e(im["src"])}" alt="{e(im.get("alt") or cap)}" loading="lazy">'
                   + (f'<span>{e(cap)}</span>' if cap else '') + '</a>')
    return f'<div class="{cls}">' + ''.join(out) + '</div>'

def logos_html(imgs):
    if not imgs:
        return ''
    return '<div class="x-logos">' + ''.join(f'<span class="x-logo rv"><img src="{e(i["src"])}" alt="{e(i.get("alt") or i.get("cap") or "Логотип")}" loading="lazy"></span>' for i in imgs) + '</div>'

def proj_article(g, d, n):
    h3, body = g['h3'], g['blocks']
    link = g.get('link')
    parts = []
    head = f'<h3>{rich(h3)}</h3>'
    if g.get('meta'):
        head = f'<span class="x-meta">{e(g["meta"])}</span>' + head
    if d == 1:
        arrow = f'<a href="{e(link["href"])}" target="_blank" rel="noopener" class="arrow" aria-label="{e(link.get("label") or h3)}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M8 7h9v9"/></svg></a>' if link else ''
        parts.append(f'<div class="proj-top"><div>{head}</div>{arrow}</div>')
    else:
        parts.append(head)
    stats = ''
    for b in body:
        t = b['type']
        if t == 'text':
            parts.append(paras(b['text'], 'proj-desc' if d == 1 else 'x-p'))
        elif t == 'stats':
            stats = '<div class="proj-stats">' + ''.join(f'<div><div class="ps-num{" x-long" if len(str(i["value"])) > 9 else ""}">{e(i["value"])}</div><div class="ps-label">{rich(i["label"])}</div></div>' for i in b['items']) + '</div>'
        elif t == 'cards':
            parts.append('<ul class="x-minis">' + ''.join(f'<li><strong>{rich(i.get("title"))}</strong>{(" — " + rich(i["text"])) if i.get("text") else ""}</li>' for i in b['items']) + '</ul>')
        elif t == 'list':
            parts.append(list_html(b))
        elif t == 'links':
            parts.append('<div class="x-plinks">' + ''.join(f'<a class="link" href="{e(i["href"])}" target="_blank" rel="noopener">{e(i["label"])} {OUT}</a>' for i in b['items'] if i.get('href')) + '</div>')
    if link and d != 1:
        parts.append(f'<a class="link" href="{e(link["href"])}" target="_blank" rel="noopener">{e(link.get("label") or "Сайт")} {OUT}</a>')
    if g.get('logo'):
        parts.insert(0, f'<span class="x-plogo"><img src="{e(g["logo"]["src"])}" alt="{e(g["logo"].get("alt") or "Логотип")}" loading="lazy"></span>')
    cls = 'proj rv'
    if d == 1:
        cls += ' proj-school' if n % 2 == 0 else ' proj-science'
    return f'<article class="{cls}">' + ''.join(parts) + stats + '</article>'

def generic_body(blocks, d, gal_group):
    """Render a section's blocks: h3-groups become project cards, the rest flows in order."""
    out, groups = [], []
    cur = None
    def flush():
        nonlocal groups
        if groups:
            out.append('<div class="projects">' + ''.join(proj_article(g, d, i) for i, g in enumerate(groups)) + '</div>')
            groups = []
    for b in blocks:
        t = b['type']
        if t == 'h3':
            cur = {'h3': b['text'], 'blocks': [], 'link': b.get('link'), 'meta': b.get('meta'), 'logo': b.get('logo')}
            groups.append(cur)
            continue
        if cur is not None and t in ('text', 'stats', 'cards', 'links', 'list'):
            cur['blocks'].append(b)
            continue
        cur = None
        flush()
        if t == 'lead':
            out.append(f'<p class="sec-lead x-lead">{rich(b["text"])}</p>')
        elif t == 'text':
            out.append(f'<div class="x-text">{paras(b["text"], "x-p")}</div>')
        elif t == 'stats':
            out.append(nums_html(b['items'], d))
        elif t == 'cards':
            out.append(cards_html(b['items']))
        elif t == 'steps':
            out.append(steps_html(b))
        elif t == 'list':
            out.append(list_html(b))
        elif t == 'quote':
            out.append(quote_html(b))
        elif t == 'links':
            out.append(links_html(b['items']))
        elif t == 'gallery':
            out.append(gallery_html(b['items'], gal_group, 'x-gallery' + (' x-docs' if b.get('docs') else '')))
        elif t == 'logos':
            out.append(logos_html(b['items']))
        elif t == 'h4':
            out.append(f'<h3 class="x-h3">{rich(b["text"])}</h3>')
    flush()
    return ''.join(out)

def sec_head(title, lead, d):
    l = f'<p class="sec-lead">{rich(lead)}</p>' if lead else ''
    return f'<div class="sec-head"><div><h2 class="sec-title">{rich(title)}</h2>{l}</div></div>'

# ---------- sections ----------

def name_lines(c, d):
    if d == 3:
        return f'<span>{e(c["first"])}</span><span>{e(c["last"])}</span>'
    return f'<span class="ln"><span>{e(c["first"])}</span></span><span class="ln"><span>{e(c["last"])}</span></span>'

def hero(c, d, img):
    h = c['hero']
    photo = (img.get('hero') or [{}])[0].get('src', '')
    stats = h.get('stats') or []
    first_target = c['nav'][0][0] if c['nav'] else 'about'
    b1 = h.get('primary') or c['nav'][0][1] if c['nav'] else 'Обо мне'
    b1 = h.get('primary') or ('Мои проекты' if first_target == 'projects' else 'Обо мне')
    if d == 1:
        facts = ''.join(f'<div class="tile fact"><span class="fact-num">{e(s["value"])}</span><p>{rich(s["label"])}</p></div>' for s in stats[:3])
        score = ''
        if h.get('badge'):
            cells = ''.join(f'<span class="cell"><span>{e(ch)}</span></span>' for ch in h['badge']['cells'])
            score = f'<div class="score"><div class="cells" aria-hidden="true">{cells}</div><p>{rich(h["badge"]["text"])}</p></div>'
        ph = f'<figure class="tile h-photo"><img src="{e(photo)}" alt="{e(c["name"])}" fetchpriority="high"></figure>' if photo else '<figure class="tile h-photo x-nophoto"></figure>'
        return f'''<section class="hero" id="top">
  <div class="wrap hero-grid">
    <div class="tile h-intro">
      <h1 class="h-name">{name_lines(c, d)}</h1>
      <p class="h-desc">{rich(h["lead"])}</p>
      <div class="h-actions">
        <a href="#{first_target}" class="btn btn-primary">{e(b1)} {ARROW}</a>
        <a href="#contact" class="btn btn-line">Связаться</a>
      </div>{score}
    </div>
    {ph}
    <div class="h-facts">{facts}</div>
  </div>
</section>'''
    if d == 2:
        creds = ''.join(f'<div class="cred"><div class="cred-v">{e(s["value"])}</div><div class="cred-l mono">{rich(s["label"])}</div></div>' for s in stats[:3])
        ph = f'<div class="hero-photo"><img src="{e(photo)}" alt="{e(c["name"])}" fetchpriority="high"></div>' if photo else ''
        return f'''<section class="hero" id="top">
  {ph}
  <div class="wrap hero-in">
    <h1 class="hero-name">{name_lines(c, d)}</h1>
    <div class="hero-rule"></div>
    <div class="hero-row">
      <div>
        <p class="hero-desc">{rich(h["lead"])}</p>
        <div class="hero-actions">
          <a href="#{first_target}" class="btn btn-gold">{e(b1)} {ARROW}</a>
          <a href="#contact" class="btn btn-line">Связаться</a>
        </div>
      </div>
      <div class="creds">{creds}</div>
    </div>
  </div>
  <div class="scroll-cue mono" aria-hidden="true">Листайте</div>
</section>'''
    facts = ''.join(f'<div class="fact"><dt>{e(s["value"])}</dt><dd>{rich(s["label"])}</dd></div>' for s in stats[:4])
    role = f'<p class="hero-role">{rich(h["role"])}</p>' if h.get('role') else ''
    ph = f'<figure class="frame hero-photo"><img src="{e(photo)}" alt="{e(c["name"])}" fetchpriority="high"></figure>' if photo else ''
    return f'''<section class="hero" id="top">
  <div class="wrap">
    <div class="hero-grid">
      <div>
        <h1 class="hero-name">{name_lines(c, d)}</h1>
        {role}
        <p class="hero-desc">{rich(h["lead"])}</p>
        <div class="hero-actions">
          <a href="#contact" class="btn btn-dark">Связаться {ARROW}</a>
          <a href="#{first_target}" class="btn btn-line">{e(b1)}</a>
        </div>
      </div>
      {ph}
    </div>
    <dl class="facts">{facts}</dl>
  </div>
</section>'''

def timeline_html(items, d):
    items = [{**i, 'year': '' if str(i.get('year', '')).strip() in ('?', '…', '—', '-') else i.get('year', '')} for i in items]
    if d == 1:
        return '<ol class="timeline">' + ''.join(f'<li class="tl rv"><span class="tl-year">{e(i["year"])}</span><div><h3>{rich(i["title"])}</h3><p>{rich(i.get("text"))}</p></div></li>' for i in items) + '</ol>'
    cls = 'cv rv' if d == 2 else 'cv'
    li = 'li' if d == 2 else 'li class="rv"'
    y = 'cv-y mono' if d == 2 else 'cv-y'
    return f'<ol class="{cls}">' + ''.join(f'<{li}><span class="{y}">{e(i["year"])}</span><div><strong>{rich(i["title"])}</strong><span>{rich(i.get("text"))}</span></div></li>' for i in items) + '</ol>'

def about(c, d, img):
    a = c['about']
    photo = (img.get('about') or [{}])[0].get('src', '')
    body = paras(a.get('text'), 'about-body')
    extra = ''
    for b in a.get('extra') or []:
        extra += generic_body([b], d, 'about')
    if a.get('quote'):
        extra += quote_html(a['quote'])
    if a.get('after'):
        extra += paras(a['after'], 'about-body')
    docs = gallery_html(img.get('diplomas_about') or [], 'docs', 'x-gallery x-docs')
    tl = timeline_html(a.get('timeline') or [], d)
    title = a.get('title') or 'Обо мне'
    if d == 1:
        st = f'<div class="about-sticker">{rich(a["sticker"][0])}<br><span>{rich(a["sticker"][1])}</span></div>' if a.get('sticker') else ''
        ph = f'<div class="about-photo rv"><img src="{e(photo)}" alt="{e(c["name"])}" loading="lazy">{st}</div>' if photo else '<div></div>'
        return f'''<section class="sec" id="about">
  <div class="wrap">{sec_head(title, '', d)}</div>
  <div class="wrap about">
    {ph}
    <div>
      <p class="about-lead">{rich(a["lead"])}</p>
      {body}{extra}
      {tl}{docs}
    </div>
  </div>
</section>'''
    if d == 2:
        ph = f'<figure class="about-wide rv" style="margin:0"><img src="{e(photo)}" alt="{e(c["name"])}" loading="lazy"></figure>' if photo else ''
        return f'''<section class="sec" id="about">
  <div class="wrap">
    <h2 class="sec-title x-mb">{rich(title)}</h2>
    {ph}
    <div class="about">
      <div>
        <p class="quote">{rich(a["lead"])}</p>
        {body}{extra}
      </div>
      {tl}
    </div>{docs}
  </div>
</section>'''
    ph = f'<figure class="frame about-photo rv"><img src="{e(photo)}" alt="{e(c["name"])}" loading="lazy"></figure>' if photo else '<div></div>'
    return f'''<section class="sec" id="about">
  <div class="wrap about">
    {ph}
    <div>
      <h2 class="sec-title">{rich(a.get("heading") or title)}</h2>
      <p class="about-body x-leadp">{rich(a["lead"])}</p>
      {body}{extra}
      {tl}{docs}
    </div>
  </div>
</section>'''

def plain_section(s, d, n):
    sid = s['id']
    if not s.get('blocks'):
        return ''
    cls = 'sec'
    if d == 2 and sid in ('results',):
        cls = 'sec results'
    elif d == 2 and n % 2 == 1:
        cls = 'sec x-alt'
    elif d == 3 and n % 2 == 1:
        cls = 'sec band'
    return f'''<section class="{cls}" id="{e(sid)}">
  <div class="wrap">
    {sec_head(s["title"], s.get("lead"), d)}
    {generic_body(s["blocks"], d, sid)}
  </div>
</section>'''

def reviews(s, d, imgs):
    if not imgs and not s.get('items'):
        return ''
    arts = []
    for it in s.get('items') or []:   # text reviews
        foot = f'<div class="rev-foot"><strong>{e(it.get("name"))}</strong><span>{e(it.get("meta"))}</span></div>'
        arts.append(f'<article class="rev"><blockquote>«{rich(it["text"])}»</blockquote>{foot}</article>')
    for im in imgs:
        cap = im.get('cap') or 'Отзыв'
        arts.append(f'<article class="rev x-rev"><a class="x-revimg" href="{e(im["src"])}" data-lb="reviews" data-caption="{e(cap)}"><img src="{e(im["src"])}" alt="{e(cap)}" loading="lazy"></a>'
                    + (f'<div class="rev-foot"><span>{e(im["cap"])}</span></div>' if im.get('cap') else '') + '</article>')
    links = links_html(s['links']) if s.get('links') else ''
    track = f'<div class="car-track" tabindex="0" aria-label="Отзывы">{"".join(arts)}</div>'
    if d == 1:
        track = f'<div class="car-viewport">{track}</div>'
    lead = f'<p class="sec-lead">{rich(s["lead"])}</p>' if s.get('lead') else ''
    return f'''<section class="sec" id="reviews">
  <div data-carousel>
    <div class="wrap sec-head">
      <div><h2 class="sec-title">{rich(s.get("title") or "Отзывы")}</h2>{lead}</div>
      <div class="car-ctrl">
        <button class="car-btn" type="button" data-prev aria-label="Предыдущие отзывы">{CHEV_L}</button>
        <button class="car-btn" type="button" data-next aria-label="Следующие отзывы">{CHEV_R}</button>
      </div>
    </div>
    {track}
    <div class="car-bar"><div><span class="car-thumb"></span></div></div>
    {f'<div class="wrap">{links}</div>' if links else ''}
  </div>
</section>'''

def books(s, d, imgs):
    items = s.get('items') or []
    if not items:
        return ''
    out = []
    for i, b in enumerate(items):
        im = imgs[i] if i < len(imgs) else None
        cover = f'<img src="{e(im["src"])}" alt="Обложка: {e(b["title"])}" loading="lazy">' if im else ''
        if d == 2:
            a = f'<a class="book-cover" href="{e(im["src"])}" data-lb="books" data-caption="{e(b["title"])}">{cover}</a>' if im else ''
            out.append(f'<div class="book rv">{a}<div><div class="book-t">{rich(b["title"])}</div><div class="book-m">{rich(b.get("meta"))}</div></div></div>')
        else:
            a = f'<a class="book-3d" href="{e(im["src"])}" data-lb="books" data-caption="{e(b["title"])}"><span class="book-cover">{cover}</span></a>' if im else ''
            t, m = ('book-title', 'book-meta') if d == 1 else ('book-t', 'book-m')
            out.append(f'<div class="book rv">{a}<div><div class="{t}">{rich(b["title"])}</div><div class="{m}">{rich(b.get("meta"))}</div></div></div>')
    cls = {1: 'sec', 2: 'sec paper', 3: 'sec band'}[d]
    return f'''<section class="{cls}" id="books">
  <div class="wrap">
    {sec_head(s.get("title") or "Книги и пособия", s.get("lead"), d)}
    <div class="books">{''.join(out)}</div>
  </div>
</section>'''

def media(c, d, pods):
    m = c.get('media') or {}
    socials = ''.join(social(i) for i in m.get('links') or [])
    boxes = ''
    for p in pods:
        poster = f'<img src="{e(p["poster"])}" alt="" loading="lazy">' if p.get('poster') else ''
        boxes += (f'<div class="x-pod rv"><div class="video" data-video="https://player.vimeo.com/video/{e(p["vimeo"])}?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479&amp;autoplay=1" data-title="{e(p["title"])}">'
                  f'{poster}<button class="video-play" type="button" aria-label="Смотреть: {e(p["title"])}"><span class="pbtn">{PLAY}</span><strong>{e(p["title"])}</strong></button></div>'
                  + (f'<p class="x-podcap">{rich(p["text"])}</p>' if p.get('text') else '') + '</div>')
    if not boxes and not socials:
        return ''
    title = m.get('title') or ('Подкасты' if pods else 'Публикации и соцсети')
    lead = f'<p class="sec-lead">{rich(m["lead"])}</p>' if m.get('lead') else ''
    pods_html = f'<div class="x-pods x-pods-{len(pods)}">{boxes}</div>' if boxes else ''
    soc = f'<div class="socials">{socials}</div>' if socials else ''
    st = m.get('socialsTitle') or ('Соцсети и каналы' if pods else '')
    if d == 1:
        return f'''<section class="sec" id="media">
  <div class="wrap">
    <div class="media x-media rv">
      <div class="x-mhead"><h2 class="sec-title">{rich(title)}</h2>{lead}</div>
      {pods_html}
      {f'<div class="x-msoc">{f"<h3 class=\"x-h3\">{e(st)}</h3>" if st else ""}{soc}</div>' if soc else ''}
    </div>
  </div>
</section>'''
    return f'''<section class="sec" id="media">
  <div class="wrap">
    {sec_head(title, m.get("lead"), d)}
    {pods_html}
    {f'<div class="x-msoc">{f"<h3 class=\"x-h3\">{e(st)}</h3>" if st else ""}{soc}</div>' if soc else ''}
  </div>
</section>'''

def contact(c, d, img):
    k = c['contact']
    photo = (img.get('contact') or [{}])[0].get('src', '')
    items = ''.join(social(i) for i in k['items'])
    title = k.get('title') or f'Связаться с {c.get("firstDat") or c["first"]}'
    lead = rich(k.get('lead'))
    topics = ''.join(f'<li>{e(t)}</li>' for t in k.get('topics') or [])
    tl = f'<ul class="contact-points">{topics}</ul>' if topics else ''
    if d == 1:
        side = f'<div class="contact-side rv"><img src="{e(photo)}" alt="{e(c["name"])}" loading="lazy"></div>' if photo else ''
        return f'''<section class="sec" id="contact">
  <div class="wrap contact{' x-nophoto' if not photo else ''}">
    {side}
    <div class="tile form-tile rv">
      <h2 class="form-title">{rich(title)}</h2>
      <p class="form-lead">{lead}</p>
      {tl}
      <div class="socials x-contacts">{items}</div>
    </div>
  </div>
</section>'''
    ph = f'<figure class="x-cphoto rv"><img src="{e(photo)}" alt="{e(c["name"])}" loading="lazy"></figure>' if photo else ''
    style = ' style="background:var(--night-2)"' if d == 2 else ''
    cls = 'sec band' if d == 3 else 'sec'
    inner = f'<div class="socials x-contacts">{items}</div>'
    if d == 3:
        inner = f'<div class="card rv">{inner}</div>'
    return f'''<section class="{cls}" id="contact"{style}>
  <div class="wrap contact">
    <div>
      <h2 class="sec-title">{rich(title)}</h2>
      <p class="sec-lead">{lead}</p>
      {tl}
      {ph}
    </div>
    <div>{inner}</div>
  </div>
</section>'''

def footer(c, d):
    f = c['footer']
    nav = ''.join(f'<a href="#{a}">{e(t)}</a>' for a, t in c['nav']) + '<a href="#contact">Контакты</a>'
    links = ''.join(f'<a href="{e(i["href"])}" target="_blank" rel="noopener">{e(i["label"])}</a>' for i in f.get('links') or [])
    name_block = f'<div class="foot-name">{e(c["first"])}<br>{e(c["last"])}</div>' if d == 1 else ''
    req = ''.join(f'<span>{e(r)}</span>' for r in f.get('req') or [])
    lh = '<h4 class="mono">' if d != 3 else '<h4>'
    links_col = f'<div class="foot-col">{lh}Ссылки</h4>{links}</div>' if links else ''
    return f'''<footer class="foot">
  <div class="wrap">
    <div class="foot-in">
      <div>{name_block}<p>{rich(f.get("text"))}</p></div>
      <div class="foot-col">{lh}Разделы</h4>{nav}</div>
      {links_col}
    </div>
    <div class="foot-bottom"><span>© <span data-year>2026</span> {e(c["name"])}</span><span class="x-req">{req}</span></div>
  </div>
</footer>'''

def header(c, d):
    nav = ''.join(f'<a href="#{a}">{e(t)}</a>' for a, t in c['nav'])
    cta = {1: 'btn btn-primary hdr-cta', 2: 'btn btn-line hdr-cta', 3: 'btn btn-line hdr-cta'}[d]
    mcta = {1: 'btn btn-green', 2: 'btn btn-gold', 3: 'btn btn-dark'}[d]
    rev = '' if d == 1 else ' data-reveal'
    return f'''<div class="progress" aria-hidden="true"></div>

<header class="hdr"{rev}>
  <div class="wrap hdr-in">
    <a href="#top" class="logo">{e(c["name"])}</a>
    <nav class="nav" aria-label="Разделы">{nav}</nav>
    <a href="#contact" class="{cta}">Связаться</a>
    <button class="burger" type="button" aria-expanded="false" aria-controls="mnav" aria-label="Открыть меню"><span></span><span></span><span></span></button>
  </div>
</header>

<div class="mnav" id="mnav" aria-hidden="true">
  {nav}
  <a href="#contact" class="{mcta}">Связаться</a>
</div>'''

# ---------- extra CSS (components the templates don't have) ----------

XCSS_COMMON = '''
.x-mb{margin-bottom:clamp(28px,4vw,48px)}
.x-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px;margin-top:clamp(28px,4vw,48px)}
.x-card{display:flex;flex-direction:column;gap:10px;padding:clamp(22px,2.6vw,32px);background:var(--x-surface);border:1px solid var(--x-line);border-radius:var(--x-r);min-width:0}
.x-card h3{margin:0;font-family:var(--f-display);font-size:clamp(19px,1.7vw,23px);line-height:1.25;font-weight:600;color:var(--x-ink);text-wrap:balance}
.x-card .x-p,.x-p{margin:0;color:var(--x-muted)}
.x-card .x-p+.x-p{margin-top:8px}
.x-meta{font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--x-accent);font-weight:600}
.x-res{margin-top:auto;padding-top:12px;border-top:1px solid var(--x-line);font-weight:600;color:var(--x-ink)}
.x-more{margin-top:auto;display:inline-flex;gap:6px;align-items:center;color:var(--x-accent);font-weight:600}
.x-text{max-width:70ch;margin-top:20px;display:grid;gap:12px}
.x-lead{margin-bottom:0}
.x-h3{font-family:var(--f-display);font-size:clamp(21px,2vw,27px);line-height:1.2;margin:clamp(32px,4vw,48px) 0 0;font-weight:600;color:var(--x-ink)}
.x-steps-wrap{margin-top:clamp(28px,4vw,48px)}
.x-steps{list-style:none;margin:18px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:16px}
.x-steps li{display:flex;gap:14px;align-items:flex-start;padding:20px;border-top:2px solid var(--x-accent);background:var(--x-surface);border-radius:0 0 var(--x-r) var(--x-r);min-width:0}
.x-steps .x-n{font-family:var(--f-display);font-size:26px;line-height:1;color:var(--x-accent);font-weight:600}
.x-steps strong{display:block;color:var(--x-ink);margin-bottom:4px}
.x-steps span{color:var(--x-muted);font-size:15.5px}
.x-list{margin:18px 0 0;padding:0;list-style:none;display:grid;gap:10px;max-width:72ch}
.x-list li{position:relative;padding-left:26px;color:var(--x-muted)}
.x-list li::before{content:"";position:absolute;left:4px;top:.6em;width:9px;height:9px;border-radius:50%;background:var(--x-accent)}
.x-minis{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.x-minis li{color:var(--x-muted)}.x-minis strong{color:var(--x-ink)}
.x-quote{margin:clamp(28px,4vw,40px) 0 0;padding:4px 0 4px 22px;border-left:3px solid var(--x-accent)}
.x-quote p{margin:0;font-family:var(--f-display);font-size:clamp(20px,2vw,26px);line-height:1.35;color:var(--x-ink);font-style:italic}
.x-quote cite{display:block;margin-top:10px;font-style:normal;font-size:14px;color:var(--x-muted)}
.x-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:14px;margin-top:clamp(28px,4vw,40px)}
.x-shot{display:flex;flex-direction:column;gap:8px;min-width:0}
.x-shot img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--x-r);border:1px solid var(--x-line);background:var(--x-surface)}
.x-docs .x-shot img{object-fit:contain;padding:8px}
.x-shot span{font-size:14px;color:var(--x-muted);line-height:1.4}
.x-logos{display:flex;flex-wrap:wrap;gap:14px;margin-top:clamp(24px,3vw,36px)}
.x-logo{display:flex;align-items:center;justify-content:center;width:150px;height:96px;padding:12px;background:#fff;border:1px solid var(--x-line);border-radius:var(--x-r)}
.x-logo img{max-width:100%;max-height:100%;object-fit:contain}
.x-plogo{display:flex;width:84px;height:56px;padding:6px;background:#fff;border-radius:calc(var(--x-r) / 2)}
.x-plogo img{max-width:100%;max-height:100%;object-fit:contain}
.x-plinks{display:flex;flex-wrap:wrap;gap:8px 18px}
.x-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:16px;margin-top:clamp(28px,4vw,40px)}
.x-stat{padding:26px;display:flex;flex-direction:column;gap:10px;min-width:0}
.x-stat p{margin:0}
.x-nums{margin-top:clamp(28px,4vw,48px)}
.x-pods{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));margin-top:clamp(24px,3vw,36px)}
.x-pods-1{grid-template-columns:minmax(0,820px)}
.x-pod{min-width:0}.x-pod .video{aspect-ratio:16/9}
.x-podcap{margin:10px 0 0;color:var(--x-muted);font-size:15px}
.x-msoc{margin-top:clamp(32px,4vw,48px)}.x-msoc .x-h3{margin-top:0}
.x-msoc .socials{grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));column-gap:24px}
.x-rev{padding:14px}
.x-revimg{display:block;border-radius:calc(var(--x-r) - 4px);overflow:hidden;background:#fff}
.x-revimg img{width:100%;height:auto;max-height:520px;object-fit:contain;object-position:top}
.x-cphoto{margin:clamp(24px,3vw,36px) 0 0;max-width:420px}
.x-cphoto img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--x-r)}
.x-req{display:flex;flex-wrap:wrap;gap:4px 16px}
.x-contacts{margin-top:24px}
.x-leadp{font-size:1.12em;color:var(--x-ink)}
.x-long{font-size:clamp(20px,2vw,26px)!important;line-height:1.15!important;overflow-wrap:anywhere;hyphens:auto}
.cred-v,.fact-num,.fact dt{overflow-wrap:anywhere}
.x-quote+.about-body,.x-quote+p{margin-top:24px}
.x-quote{margin-bottom:8px}
@media (max-width:760px){.x-steps{grid-template-columns:1fr}.x-logo{width:calc(50% - 7px)}}
'''
XCSS = {
1: ''':root{--x-surface:var(--tile);--x-line:var(--line);--x-ink:var(--ink);--x-muted:var(--ink-2);--x-accent:var(--green-ink);--x-r:var(--r)}
.x-media{grid-template-columns:1fr;align-items:start}
.x-media .sec-title{color:#fff}.x-media .sec-lead{color:rgba(233,240,230,.75)}
.x-media .x-h3{color:#fff}
.x-media .x-podcap{color:rgba(233,240,230,.75)}
.x-contacts .social{background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);color:var(--ink)}
.x-contacts .social span span{color:var(--ink-2)}
.x-contacts .social strong{color:var(--ink)}
.contact.x-nophoto{grid-template-columns:1fr}
.x-steps li{background:var(--tile);box-shadow:0 0 0 1px var(--line)}
.x-nophoto.h-photo{background:var(--green-soft)}
''',
2: ''':root{--x-surface:var(--night-2);--x-line:var(--line);--x-ink:var(--parch);--x-muted:var(--parch-2);--x-accent:var(--gold);--x-r:2px}
.x-alt{background:var(--night-2)}.x-alt .x-card,.x-alt .x-steps li{background:var(--night-3)}
.x-logo,.x-plogo{background:var(--parch)}
.x-revimg{background:var(--parch)}
''',
3: ''':root{--x-surface:var(--card);--x-line:var(--line);--x-ink:var(--ink);--x-muted:var(--ink-2);--x-accent:var(--accent);--x-r:var(--r)}
.band .x-card,.band .x-steps li{background:var(--bg)}
''',
}

# ---------- page ----------

def split_template(d):
    s = TPL[d].read_text(encoding='utf-8')
    head = s[:s.find('</head>')]
    script = s[s.rfind('<script'):s.rfind('</body>')]
    return head, script

def build(slug):
    c = json.loads((SKILL / 'content' / f'{slug}.json').read_text(encoding='utf-8'))
    d = int(c['design'])
    img = prep_images(c)
    pods = pod_posters(c)
    # sections in order; nav from what's present
    secs = c.get('sections') or []
    nav = []
    if any(s['id'] == 'projects' for s in secs):
        nav.append(('projects', 'Проекты'))
    nav.append(('about', 'Обо мне'))
    for s in secs:
        if s['id'] != 'projects' and s.get('nav') and s.get('blocks'):
            nav.append((s['id'], s['nav']))
    if (c.get('reviews') or {}).get('items') or img.get('reviews'):
        nav.append(('reviews', 'Отзывы'))
    if (c.get('books') or {}).get('items'):
        nav.append(('books', 'Книги'))
    if pods or (c.get('media') or {}).get('links'):
        nav.append(('media', 'Подкасты' if pods else 'Соцсети'))
    c['nav'] = nav

    # inject picked images into sections
    for s in secs:
        for slot in s.get('slots') or []:
            if img.get(slot):
                kind = 'logos' if slot == 'logo' else 'gallery'
                s['blocks'].append({'type': kind, 'items': img[slot], 'docs': slot in ('diplomas', 'results')})
        for b in s['blocks']:
            if b['type'] == 'h3' and isinstance(b.get('logo'), int):
                b['logo'] = img['logo'][b['logo']]
    if c.get('diplomasIn') == 'about':
        img['diplomas_about'] = img.get('diplomas') or []

    parts = [header(c, d), '<main>', hero(c, d, img)]
    order = c.get('order') or ['projects', 'about', '*', 'reviews', 'books', 'media', 'contact']
    by_id = {s['id']: s for s in secs}
    rest = [s for s in secs if s['id'] != 'projects']
    n = 0
    for key in order:
        if key == 'projects' and 'projects' in by_id:
            parts.append(plain_section(by_id['projects'], d, n)); n += 1
        elif key == 'about':
            parts.append(about(c, d, img)); n += 1
        elif key == '*':
            for s in rest:
                parts.append(plain_section(s, d, n)); n += 1
        elif key == 'reviews':
            parts.append(reviews(c.get('reviews') or {}, d, img.get('reviews') or []))
        elif key == 'books':
            parts.append(books(c.get('books') or {}, d, img.get('books') or []))
        elif key == 'media':
            parts.append(media(c, d, pods))
        elif key == 'contact':
            parts.append(contact(c, d, img))
    parts.append('</main>')
    parts.append(footer(c, d))

    head, script = split_template(d)
    title = c['name']
    desc = c.get('description') or c['hero']['lead']
    head = re.sub(r'<title>.*?</title>', f'<title>{e(title)}</title>', head, flags=re.S)
    head = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{e(re.sub(r"[*]", "", desc))}">', head)
    head = re.sub(r'\s*<link rel="(icon|apple-touch-icon)"[^>]*>', '', head)
    head = head.replace('</style>', XCSS_COMMON + XCSS[d] + (c.get('css') or '') + '</style>') if '</style>' in head else head + f'<style>{XCSS_COMMON}{XCSS[d]}</style>'
    page = head + '</head>\n<body>\n\n' + '\n\n'.join(p for p in parts if p) + '\n\n' + script + '</body>\n</html>\n'
    (CLIENT / slug).write_text(page, encoding='utf-8')
    print('built', slug, f'design {d}', f'{len(page)//1024} KB')

if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['--all']:
        args = sorted(p.stem for p in (SKILL / 'content').glob('*.json'))
    for a in args:
        build(a)
