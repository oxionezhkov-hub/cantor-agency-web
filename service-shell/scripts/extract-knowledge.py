#!/usr/bin/env python3
"""Rebuild the preview's offline library from tracked academy/base source HTML.

No source JavaScript, forms, feedback calls, event handlers or embedded styles are
copied. Theory and self-check text remain verbatim; source attribution is kept.
Run from any directory: python service-shell/scripts/extract-knowledge.py
"""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'service-shell/src/features/knowledge/content.ts'
VOID = {'br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr'}
ALLOWED = set('section article div span p h2 h3 h4 h5 h6 b strong em i small ul ol li table thead tbody tfoot tr th td blockquote pre code a br hr details summary'.split())
DROP = {'script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'input', 'textarea', 'svg', 'link', 'meta'}

class Node:
    def __init__(self, tag='', attrs=(), children=None):
        self.tag, self.attrs, self.children = tag, dict(attrs), children or []
    def has(self, cls):
        return cls in self.attrs.get('class', '').split()
    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()
    def text(self):
        return ' '.join(c.text() if isinstance(c, Node) else c for c in self.children)

class Parser(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node('root')
        self.stack = [self.root]
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)
    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break
    def handle_data(self, data):
        self.stack[-1].children.append(data)

def clean_text(node):
    return re.sub(r'\s+', ' ', node.text()).strip()

def render(node, lesson_id, skip_tasks=True):
    if isinstance(node, str):
        return escape(node, quote=False)
    # Keep the sole training recording accessible without embedding third-party code.
    if node.tag == 'iframe':
        match = re.fullmatch(r'https://player\.vimeo\.com/video/(\d+)(?:\?.*)?', node.attrs.get('src', ''))
        if match:
            return '<p><a href="https://vimeo.com/' + match[1] + '" target="_blank" rel="noopener noreferrer">Смотреть запись: ' + escape(node.attrs.get('title', 'Обучение'), quote=False) + ' ↗</a></p>'
        raise ValueError('Unrecognized embedded media; preserve it as a reviewed safe link')
    if node.tag in DROP or (skip_tasks and node.has('task-def')):
        return ''
    if any(node.has(c) for c in ['doc-nav', 'toc', 'doc-title', 'doc-meta', 'reg-title']):
        return ''
    body = ''.join(render(c, lesson_id, skip_tasks) for c in node.children)
    if node.tag not in ALLOWED:
        return body
    tag = 'h2' if node.has('step-title') else node.tag
    attrs = {}
    if node.attrs.get('class'):
        attrs['class'] = node.attrs['class']
    if node.attrs.get('id'):
        attrs['id'] = lesson_id + '-' + node.attrs['id']
    if tag == 'a':
        href = node.attrs.get('href', '')
        if href.startswith('#'):
            attrs['href'] = '#' + lesson_id + '-' + href[1:]
            attrs['data-knowledge-anchor'] = lesson_id + '-' + href[1:]
        elif href.startswith('/base/'):
            filename, _, anchor = href.removeprefix('/base/').partition('#')
            target = 'base-' + filename
            attrs['href'] = 'https://cantor.agency' + href
            attrs['data-knowledge-lesson'] = target
            if anchor:
                attrs['data-knowledge-anchor'] = target + '-' + anchor
        elif href.startswith(('https://', 'http://', 'mailto:', 'tel:')):
            attrs['href'] = href
            attrs['target'] = '_blank'
            attrs['rel'] = 'noopener noreferrer'
        elif href.startswith('/'):
            attrs['href'] = 'https://cantor.agency' + href
            attrs['target'] = '_blank'
            attrs['rel'] = 'noopener noreferrer'
        else:
            return body
    if tag in ('th', 'td'):
        for key in ('colspan', 'rowspan'):
            if node.attrs.get(key, '').isdigit():
                attrs[key] = node.attrs[key]
    attributes = ''.join(' ' + k + '="' + escape(v, quote=True) + '"' for k, v in attrs.items())
    if tag in VOID:
        return '<' + tag + attributes + '>'
    return '<' + tag + attributes + '>' + body + '</' + tag + '>'

def headings_for(node, lesson_id):
    headings = []
    for item in node.walk():
        if item.tag == 'h2' or item.has('step-title'):
            if not item.attrs.get('id'):
                item.attrs['id'] = 'heading-' + str(len(headings) + 1)
            headings.append({'id': lesson_id + '-' + item.attrs['id'], 'title': clean_text(item)})
    return headings

academy = (ROOT / 'academy').read_text()
modules = re.findall(r"\{id: (\d+), title: '([^']+)', desc: '([^']+)', time: '(\d+) мин'\}", academy)
assert len(modules) == 14
academy_tree = Parser(academy).root
lessons = []
originals = {}
for number, title, description, minutes in modules:
    template = next(n for n in academy_tree.walk() if n.tag == 'template' and n.attrs.get('id') == 'mod-' + number)
    lesson_id = 'course-' + number
    tasks = []
    for task in template.walk():
        if task.has('task-def'):
            answer = next(n for n in task.walk() if n.has('task-key'))
            question = Node('div', children=[c for c in task.children if c is not answer])
            tasks.append({'id': lesson_id + '-' + task.attrs['data-id'], 'title': task.attrs['data-title'], 'html': render(question, lesson_id), 'answerHtml': render(answer, lesson_id)})
    originals[lesson_id] = template
    headings = headings_for(template, lesson_id)
    lessons.append({'id': lesson_id, 'title': title, 'description': description,
        'track': 'team' if number in ('1', '13', '14') else 'dialogues' if number == '12' else 'promotion',
        'kind': 'course', 'order': int(number), 'minutes': int(minutes),
        'html': render(template, lesson_id), 'headings': headings, 'tasks': tasks,
        'source': {'path': 'academy#mod-' + number, 'label': 'Обучение стажёров · модуль ' + number, 'url': 'https://cantor.agency/academy'},
        'searchText': clean_text(template)})

base_files = sorted(p for p in (ROOT / 'base').iterdir() if p.is_file() and p.name != 'index.html')
assert len(base_files) == 12
for index, path in enumerate(base_files):
    tree = Parser(path.read_text()).root
    wrap = next(n for n in tree.walk() if n.has('wrap'))
    title = clean_text(next(n for n in wrap.walk() if n.has('doc-title')))
    description = clean_text(next(n for n in wrap.walk() if n.has('doc-meta')))
    lesson_id = 'base-' + path.name
    track = 'dialogues' if path.name == 'reglament-dialogi-zayavki' else 'promotion' if path.name in ('reglament-1-zapusk', 'reglament-avtozagruzka', 'reglament-oformlenie-obyavleniy', 'reglament-3-soprovozhdenie', 'zapusk-novogo-klienta', 'keisy-i-nablyudeniya') else 'team'
    originals[lesson_id] = wrap
    headings = headings_for(wrap, lesson_id)
    lessons.append({'id': lesson_id, 'title': title, 'description': description, 'track': track,
        'kind': 'reference', 'order': index + 1, 'minutes': max(5, round(len(clean_text(wrap).split()) / 150)),
        'html': render(wrap, lesson_id), 'headings': headings, 'tasks': [],
        'source': {'path': 'base/' + path.name, 'label': 'База знаний · регламент', 'url': 'https://cantor.agency/base/' + path.name},
        'searchText': clean_text(wrap)})

prefix = '''// Generated by scripts/extract-knowledge.py from academy and base; do not edit HTML by hand.
// Sources are trusted tracked files; the generator strips active content and allows safe tags/attributes only.
export type KnowledgeTrack = 'promotion' | 'dialogues' | 'team';
export interface KnowledgeTask { id: string; title: string; html: string; answerHtml: string }
export interface KnowledgeLesson {
  id: string;
  title: string;
  description: string;
  track: KnowledgeTrack;
  kind: 'course' | 'reference';
  order: number;
  minutes: number;
  html: string;
  source: { path: string; label: string; url: string };
  headings: { id: string; title: string }[];
  searchText: string;
  tasks: KnowledgeTask[];
}
export const knowledgeLessons: KnowledgeLesson[] = '''
# Validate the artifact rather than trusting successful parsing to imply coverage.
expected_ids = {'course-' + str(i) for i in range(1, 15)} | {'base-' + p.name for p in base_files}
assert {lesson['id'] for lesson in lessons} == expected_ids
assert len(lessons) == len(expected_ids) == 26
assert sum(len(lesson['tasks']) for lesson in lessons) == 28
all_html = {lesson['id']: lesson['html'] for lesson in lessons}

def retained_text_chunks(node):
    if isinstance(node, str):
        if node.strip():
            yield re.sub(r'\s+', ' ', node).strip()
        return
    if node.tag in DROP or node.has('task-def') or any(node.has(c) for c in ('doc-nav', 'toc', 'doc-title', 'doc-meta', 'reg-title')):
        return
    for child in node.children:
        yield from retained_text_chunks(child)

for lesson in lessons:
    parsed = Parser(lesson['html']).root
    plain_text = clean_text(parsed)
    cursor = 0
    # Every retained text node must appear in source order in the output.
    # Only source chrome, controls, scripts and separately rendered tasks are excluded.
    for chunk in retained_text_chunks(originals[lesson['id']]):
        found = plain_text.find(chunk, cursor)
        assert found >= 0, (lesson['id'], 'Lost source text', chunk[:100])
        cursor = found + len(chunk)

# Original transfer has now been checked in full. Apply the reviewed tutor-facing
# interpretation only to the generated artifact; academy/base remain untouched.
guidance_path = ROOT / 'service-shell/src/features/knowledge/tutor-guidance.json'
guidance = json.loads(guidance_path.read_text())
assert set(guidance) == {lesson['id'] for lesson in lessons if lesson['kind'] == 'reference'} | {'course-1', 'course-2', 'course-12', 'course-13', 'course-14'}
for lesson in lessons:
    entry = guidance.get(lesson['id'])
    if not entry:
        continue
    if 'sections' in entry:
        lesson['title'] = entry['title']
        lesson['description'] = entry['description']
        lesson['track'] = entry.get('track', lesson['track'])
        tree = Node('div', children=[Node('section', children=[
            Node('h2', [('id', section['id'])], [section['title']]),
            Parser(section['html']).root,
        ]) for section in entry['sections']])
        lesson['headings'] = headings_for(tree, lesson['id'])
        lesson['html'] = render(tree, lesson['id'])
        if 'tasks' in entry:
            lesson['tasks'] = [{
                'id': lesson['id'] + '-' + task['id'], 'title': task['title'],
                'html': render(Parser(task['html']).root, lesson['id']),
                'answerHtml': render(Parser(task['answerHtml']).root, lesson['id']),
            } for task in entry['tasks']]
        lesson['minutes'] = max(3, round(len(clean_text(tree).split()) / 150))
        lesson['source']['label'] = 'Практика для преподавателя'
    if 'replacements' in entry:
        def replace_text(value):
            if isinstance(value, str):
                for before, after in entry['replacements']:
                    value = value.replace(before, after)
                return value
            if isinstance(value, list):
                return [replace_text(item) for item in value]
            if isinstance(value, dict):
                return {key: replace_text(item) for key, item in value.items()}
            return value
        lesson.update(replace_text(lesson))
    lesson['searchText'] = clean_text(Parser(lesson['html']).root) + ' ' + ' '.join(
        task['title'] + ' ' + clean_text(Parser(task['html'] + task['answerHtml']).root)
        for task in lesson['tasks'])

assert sum(len(lesson['tasks']) for lesson in lessons) == 28
all_html = {lesson['id']: lesson['html'] for lesson in lessons}
for lesson in lessons:
    parsed = Parser(lesson['html']).root
    element_ids = [node.attrs['id'] for node in parsed.walk() if 'id' in node.attrs]
    assert len(element_ids) == len(set(element_ids)), (lesson['id'], 'Duplicate anchor')
    for heading in lesson['headings']:
        assert heading['id'] in element_ids, (lesson['id'], 'Missing heading target', heading)
    for node in parsed.walk():
        assert node.tag == 'root' or node.tag in ALLOWED, (lesson['id'], 'Unsafe tag', node.tag)
        assert set(node.attrs) <= {'id', 'class', 'href', 'target', 'rel', 'data-knowledge-anchor', 'data-knowledge-lesson', 'colspan', 'rowspan'}
        if 'href' in node.attrs:
            assert node.attrs['href'].startswith(('#', 'https://', 'http://', 'mailto:', 'tel:')), (lesson['id'], 'Unsafe URL')
        target = node.attrs.get('data-knowledge-lesson', lesson['id'])
        if 'data-knowledge-lesson' in node.attrs:
            assert target in expected_ids, (lesson['id'], 'Unknown lesson target', target)
        if 'data-knowledge-anchor' in node.attrs:
            assert 'id="' + node.attrs['data-knowledge-anchor'] + '"' in all_html[target], (lesson['id'], 'Broken anchor', node.attrs)
    for task in lesson['tasks']:
        assert task['answerHtml'] not in lesson['html'], (lesson['id'], 'Self-check answer leaked into theory')
        assert task['html'] and task['answerHtml']
        for node in Parser(task['html'] + task['answerHtml']).root.walk():
            assert node.tag == 'root' or node.tag in ALLOWED
            assert not any(attr.startswith('on') for attr in node.attrs)

rendered = prefix + json.dumps(lessons, ensure_ascii=False, indent=2) + ';\n'
if '--check' in sys.argv:
    assert OUTPUT.read_text() == rendered, 'Generated content is stale or nondeterministic; rerun this script without --check'
else:
    OUTPUT.write_text(rendered)
print(f'Generated {len(lessons)} lessons: {len(modules)} academy modules, {len(base_files)} base documents, {sum(len(l["tasks"]) for l in lessons)} self-check tasks.')
