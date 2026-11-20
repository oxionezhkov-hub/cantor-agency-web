"""Rebuild PDF from Markdown. Dependency: reportlab; Debian DejaVu Sans fonts."""
from pathlib import Path
from html import escape
import re
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph
root=Path(__file__).resolve().parents[3]
source=root/'docs/service/avito-application-guide.md'
pdfmetrics.registerFont(TTFont('Guide','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('GuideBold','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
styles=getSampleStyleSheet()
for name in ['Normal','Heading1','Heading2']:
 styles[name].fontName='Guide' if name=='Normal' else 'GuideBold'
 styles[name].fontSize={'Normal':10,'Heading1':19,'Heading2':13}[name]
 styles[name].leading={'Normal':15,'Heading1':25,'Heading2':19}[name]
 styles[name].spaceAfter=9
flow=[]
for block in source.read_text().strip().split('\n\n'):
 kind='Heading2' if block.startswith('## ') else 'Heading1' if block.startswith('# ') else 'Normal'
 text=escape(re.sub(r'^#{1,2} ','',block)).replace('\n','<br/>')
 text=re.sub(r'(https://[^\s<]+)',r'<link href="\1" color="#b53520">\1</link>',text)
 flow.append(Paragraph(text,styles[kind]))
def footer(canvas,doc):
 canvas.setFont('Guide',8);canvas.drawString(40,27,'Cantor · Заявка на приложение Авито · 20.11.2026');canvas.drawRightString(555,27,str(doc.page))
SimpleDocTemplate(str(source.with_suffix('.pdf')),pagesize=(595.28,841.89),rightMargin=40,leftMargin=40,topMargin=36,bottomMargin=45,title='Как подать заявку на приложение Авито',author='Cantor').build(flow,onFirstPage=footer,onLaterPages=footer)
