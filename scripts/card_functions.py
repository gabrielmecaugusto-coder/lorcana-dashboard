"""Card functions (Função > Subfunção > Habilidade) and Momento, read from the TCGplayer card text.
Taxonomy defined with Gabriel (Nov/2026). Writes site/data/functions.json for the public site
(deck analyser) and is reused by the private Duels.ink build. No Duels.ink data here."""
import json, re, sys
from pathlib import Path
from build_site_data import identity

num = lambda v: int(v) if v and str(v).isdigit() else None
I = re.I

# (função, subfunção, habilidade, regex)  — order matters only for display
RULES = [
  # ---- Remoção: interacts with ready characters
  ('Remoção', 'Em massa', 'Wipe / todos os oponentes', r"banish all (opposing )?(damaged )?characters|banish any number of chosen opposing|(deal \d+ damage|put \d+ damage counters?) (to|on) each opposing|exert all opposing|put all opposing characters|deal \d+ damage to each opposing"),
  ('Remoção', 'Em massa', 'Vários alvos', r"(banish|deal \d+ damage to|deal \d+ damage each to|exert) up to \d+ chosen|(banish|deal \d+ damage to|exert) (two|2|three|3) chosen"),
  ('Remoção', 'Em massa', 'Repete ou espalha dano', r"in a challenge, deal damage|deal that much damage to|same amount of damage to"),
  ('Remoção', 'Simples', 'Causar dano', r"deal (\d+ )?damage( equal to [^.]{0,40})? to (another |up to \d+ )?chosen|put (\d+|a) damage counters? on chosen"),
  ('Remoção', 'Simples', 'Banir', r"banish (another )?chosen|banish (her|him|them|that character)\b|chooses and banishes"),
  ('Disrupção', 'Mesa', 'Voltar para a mão', r"return (another |up to \d+ )?chosen (opposing )?(character|item|location|card)[^.]{0,60}to (their|its|his|her) player's hand|return chosen [^.]{0,60}to (their|its) player's hand"),
  ('Remoção', 'Simples', 'Exaurir', r"exert (another |up to \d+ )?chosen( \w+)? character|chooses and exerts"),
  ('Remoção', 'Simples', 'Mover dano', r"move (up to )?\d+ damage( counters?)?[^.]{0,40}to chosen opposing"),
  ('Remoção', 'Simples', 'Para o inkwell ou fundo do deck', r"chosen (opposing )?(character|item|location)[^.]{0,50}(into (their|its) player's inkwell|on the bottom of (their|its) player's deck)|shuffle chosen [^.]{0,40}into (their|its) player's deck"),
  # ---- Controle de mesa
  ('Controle de mesa', 'Desafio', 'Challenger', r"\bChallenger \+"),
  ('Controle de mesa', 'Desafio', 'Rush', r"\bRush\b|can challenge (the turn|ready characters)"),
  ('Controle de mesa', 'Desafio', 'Reckless', r"\bReckless\b"),
  ('Controle de mesa', 'Desafio', 'Alert', r"\bAlert\b"),
  ('Controle de mesa', 'Desafio', 'Bônus no seu turno', r"(?!x)x"),  # set in classify(): Resist/Ward/+Willpower only during your turn
  ('Controle de mesa', 'Força', 'Aumentar força', r"gets? \+\d+ (Strength|\{S\})|\+\d+ \{S\}|\bSupport\b|gains? (Challenger|Rush)|with their Willpower instead|instead of their Strength"),
  ('Controle de mesa', 'Força', 'Reduzir força', r"gets? -\d+ (Strength|\{S\})|-\d+ \{S\}|loses? (\d+ )?Strength"),
  ('Controle de mesa', 'Ready', 'Preparar', r"\bready (this|chosen|another|your|all|that|them|him|her)\b"),
  ('Disrupção', 'Mesa', 'Travar (não prepara / desafia / questa)', r"(opposing|chosen|they|opponents?'?s?)[^.]{0,40}can't (ready|challenge|quest)|can't (challenge|quest) (during their next turn|until)"),
  # ---- Draw
  ('Draw', 'Filter', 'Repõe a si mesma', r"(?!x)x"),  # set in classify(): an action that only replaces itself
  ('Draw', 'Filter', 'Compra e descarta', r"draw (a|\d+|two|three) cards?,? then (choose and )?discard"),
  ('Draw', 'Filter', 'Olha o topo / reordena', r"look at the top (\d+ cards?|card) of (your|chosen player.s) deck|reveal the top card of your deck|top \d+ cards of your deck[^.]{0,60}(on the (top|bottom)|in any order)"),
  ('Draw', 'Card advantage', 'Comprar', r"\bdraws? (a|an|\d+|two|three|one|that many|cards?)\b|draw until"),
  ('Draw', 'Card advantage', 'Recuperar do descarte', r"from your discard (in)?to your hand|return this card to your hand|return [^.]{0,60}card from your discard|play [^.]{0,40}from your discard|from your discard[^.]{0,30}for free"),
  ('Draw', 'Card advantage', 'Buscar no deck', r"search your deck|(put|reveal)[^.]{0,40}into (your|their) hand"),
  # ---- Aceleração
  ('Aceleração', 'Gerar ink', 'Ramp', r"into your inkwell|additional card in your inkwell|ink from (your|their) discard|put an additional card"),
  ('Aceleração', 'Gerar ink drop', 'Ink drop', r"ink drop"),
  ('Aceleração', 'Cortar custo', 'Reduzir custo', r"pay \d+ (\{I\} |ink )?less|costs? \d+ (\{I\} |ink )?less|\d+ less to play"),
  ('Aceleração', 'Cortar custo', 'Jogar de graça', r"for free|without paying"),
  ('Aceleração', 'Cortar custo', 'Shift', r"\bShift\b"),
  ('Aceleração', 'Cortar custo', 'Cantar (Singer)', r"\bSinger \d|\+\d+ cost to sing"),
  # ---- Disrupção
  ('Disrupção', 'Mão', 'Oponente descarta', r"(each|chosen) opponent[^.]{0,30}discards?|opponents? (chooses and )?discards?|each player[^.]{0,40}discards?|players? with the most cards in (their|his|her) hand[^.]{0,40}discards?"),
  ('Disrupção', 'Mão', 'Revela a mão', r"reveals? (their|his|her) hand|look at (each|an?|chosen) (opponent|player)'?s? hand"),
  ('Disrupção', 'Lore', 'Oponente perde lore', r"(opponent|player)s? (each )?loses? \d+ lore|loses? \d+ lore"),
  ('Disrupção', 'Lore', 'Impede ganhar lore', r"can't gain lore"),
  ('Disrupção', 'Lore', 'Reduz lore do oponente', r"opposing [^.]{0,30}gets? -\d+ (Lore|\{L\})"),
  ('Disrupção', 'Recursos', 'Descarte do oponente', r"(opponent|chosen player)'?s? discard|cards? from chosen player's discard"),
  ('Disrupção', 'Recursos', 'Tinta do oponente', r"(opponent|player)[^.]{0,50}inkwell[^.]{0,40}(hand|discard)|from (their|an opponent's) inkwell"),
  ('Disrupção', 'Regras', 'Impede jogar ou cantar', r"opponents? can't (play|sing)|can't play (actions|songs|items)"),
  # ---- Pressão de lore
  ('Pressão de lore', 'Lore', 'Ganhar lore', r"gain \d+ lore|gain lore equal|(gets?|gains?) \+\d+ (Lore|\{L\})|\+\d+ \{L\}"),
  # ---- Proteção / evasão
  ('Proteção / evasão', 'Evasão', 'Evasive', r"\bEvasive\b"),
  ('Proteção / evasão', 'Evasão', 'Imune a desafio', r"can't be challenged|can’t be challenged|takes no damage"),
  ('Proteção / evasão', 'Defesa', 'Ward', r"\bWard\b"),
  ('Proteção / evasão', 'Defesa', 'Resist', r"\bResist \+"),
  ('Proteção / evasão', 'Defesa', 'Bodyguard', r"\bBodyguard\b"),
  ('Proteção / evasão', 'Defesa', 'Aumentar vontade', r"gets? \+\d+ (Willpower|\{W\})|\+\d+ \{W\}"),
  ('Proteção / evasão', 'Cura', 'Remover dano', r"remove (up to )?\d+ damage|remove all damage"),
]
RULES = [(f, s, h, re.compile(rx, I if not rx.startswith(r"\b") or ' ' in rx else 0)) for f, s, h, rx in RULES]
KEYWORDS = re.compile(r"^(Shift|Evasive|Rush|Ward|Resist|Bodyguard|Challenger|Support|Singer|Reckless|Vanish|Boost|Sing Together)\b")

MOMENTS = [  # (momento, regex) checked in order on each ability segment
  ('Ao ser banido', r"when(ever)? this (character|item|location) is banished"),
  ('Ao banir', r"whenever (this character|one of your characters) banishes|banishes another character"),
  ('Ao desafiar', r"whenever this character challenges|while challenging|in a challenge|challenges another|is challenged"),
  ('Ao questar', r"whenever (this character|one of your [^.]{0,30}|a character) quests|quests"),
  ('Ao cantar', r"sings a song|whenever you play a song|sing a song|exert to sing"),
  ('Início do turno', r"at the start of your turn"),
  ('Fim do turno', r"at the end of (your|the|each) turn"),
  ('Ao jogar', r"when you play this"),
  ('Ao jogar outra carta', r"whenever you play|when you play"),
  ('Ativada (custo)', r"EXERT|^[^.]{0,40}\d+ \{?I\}? —|—"),
]
MOMENTS = [(m, re.compile(rx, I)) for m, rx in MOMENTS]

def segments(t, ctype):
    """split card text into abilities: (kind, text). Keywords become their own segments."""
    t = re.sub(r"(\w)> ?\+", r"\1 +", t)  # "Resist> +1" typos in the TCGplayer text
    t = t.replace('[Exert]', 'EXERT').replace('{E}', 'EXERT').replace('\r', '')
    parts = re.split(r"\[[^\]]+\]", t)
    segs = []
    head = parts[0]
    # keyword lines / keywords before the first named ability
    for line in re.split(r"\n+", head):
        line = line.strip()
        if not line: continue
        if ctype in ('Action',) or (ctype == 'Action' and 'sing this song' in line):
            line = re.sub(r"\([^)]*\)", "", line).strip()
            if line: segs.append(('action', line))
        else:
            for kw in re.finditer(r"(Shift(?: \d+)?|Evasive|Rush|Ward|Resist \+\d|Bodyguard|Challenger \+\d|Support|Singer \d|Reckless|Alert|Vanish|Boost \d|Sing Together \d)", line):
                segs.append(('keyword', kw.group(1)))
            rest = re.sub(r"\([^)]*\)", "", line)
            rest = re.sub(r"(Shift(?: \d+)?( \{?I\}?| Ink)?|Evasive|Rush|Ward|Resist \+\d|Bodyguard|Challenger \+\d|Support|Singer \d|Reckless|Alert|Vanish|Boost \d( \{?I\}?)?)", "", rest).strip(' .:')
            if len(rest) > 12: segs.append(('ability', rest))
    for p in parts[1:]:
        p = p.strip()
        if p: segs.append(('action' if ctype == 'Action' else 'ability', re.sub(r"\([^)]*\)", "", p)))
    return segs

KW_MOMENT = {'Challenger': 'Ao desafiar', 'Shift': 'Ao jogar', 'Singer': 'Ao cantar', 'Support': 'Ao questar', 'Boost': 'Ativada (custo)', 'Sing': 'Ao cantar'}
def moment_of(kind, s, ctype):
    if kind == 'keyword': return KW_MOMENT.get(s.split()[0], 'Contínuo')
    if kind == 'action': return 'Ação / música (ao jogar)'
    for m, rx in MOMENTS:
        if rx.search(s): return m
    return 'Contínuo'

def classify_product(p):
    """-> (product, text, [(função, subfunção, habilidade, momento, trecho)])"""
    t = p.get('text') or ''; ctype = p.get('cardType')
    out = []  # (função, sub, habilidade, momento, segment)
    for kind, s in segments(t, ctype):
        hits = set()
        for f, sub, h, rx in RULES:
            if rx.search(s):
                if f == 'Remoção' and sub == 'Simples' and any(x[0] == 'Remoção' and x[1] == 'Em massa' for x in hits): continue
                hits.add((f, sub, h))
        if ('Draw', 'Filter', 'Compra e descarta') in hits:  # net card advantage? draw N, discard M
            W = {'a': 1, 'one': 1, 'two': 2, 'three': 3}
            m1 = re.search(r"draw (a|\d+|one|two|three) cards?", s, I); m2 = re.search(r"discard (a|\d+|one|two|three) cards?", s, I)
            nd = W.get(m1.group(1).lower(), int(m1.group(1)) if m1 and m1.group(1).isdigit() else 1) if m1 else 1
            nx = W.get(m2.group(1).lower(), int(m2.group(1)) if m2 and m2.group(1).isdigit() else 1) if m2 else 1
            spent = 1 if ctype == 'Action' else 0  # an action/song goes to the discard: it is one of the cards "spent"
            if nd - nx - spent > 0: hits.discard(('Draw', 'Filter', 'Compra e descarta'))
            else: hits.discard(('Draw', 'Card advantage', 'Comprar'))
        elif ctype == 'Action' and ('Draw', 'Card advantage', 'Comprar') in hits:
            m1 = re.search(r"draw (a|an|\d+|one|two|three) cards?", s, I)
            W = {'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3}
            nd = (W.get(m1.group(1).lower()) or int(m1.group(1))) if m1 else 2
            if nd <= 1: hits.discard(('Draw', 'Card advantage', 'Comprar')); hits.add(('Draw', 'Filter', 'Repõe a si mesma'))
        if re.search(r"during your turn", s, I):  # defensive keywords only on your turn = built to attack
            for h in [('Proteção / evasão', 'Defesa', 'Resist'), ('Proteção / evasão', 'Defesa', 'Ward'), ('Proteção / evasão', 'Defesa', 'Aumentar vontade')]:
                if h in hits: hits.discard(h); hits.add(('Controle de mesa', 'Desafio', 'Bônus no seu turno'))
        if ('Draw', 'Card advantage', 'Buscar no deck') in hits: hits.discard(('Draw', 'Filter', 'Olha o topo / reordena'))
        mo = moment_of(kind, s, ctype)
        for f, sub, h in hits: out.append((f, sub, h, mo, s))
    sh = re.search(r"\bShift (\d+)", t)
    eff = min([x for x in [num(p.get('cost')), int(sh.group(1)) if sh else None] if x] or [9])
    lore = num(p.get('lore')) or 0
    if ctype == 'Character' and lore >= 2 and lore / eff >= 0.66:
        out.append(('Pressão de lore', 'Lore', 'Lore alto e barato', 'Contínuo', ''))
    if not t.strip() or not segments(t, ctype):
        out.append(('Corpo', 'Corpo', 'Vanilla', '—', ''))
    elif not out:
        out.append(('Outros', 'Outros', 'Outros', '—', ''))
    return p, t, out


# ---- descriptions shown on hover
FUNCS_DESC = {
 'Remoção': 'Tira de jogo ou neutraliza personagens que estão em pé (prontos): dano, banir, exaurir, mover dano, mandar para o inkwell ou fundo do deck. Um desafio comum num personagem exaurido não conta.',
 'Controle de mesa': 'Ajuda a ganhar as trocas na mesa: força (aumentar ou reduzir, inclusive Support), desafio (Challenger, Rush, Reckless) e preparar (ready) personagens.',
 'Draw': 'Mexe nas cartas da sua mão e do seu deck: card advantage (ganha cartas a mais) ou filter (troca cartas sem ganhar a mais).',
 'Aceleração': 'Deixa você jogar mais coisas antes: gerar tinta (ramp), gerar ink drop ou cortar custo (reduzir custo, jogar de graça, Shift, cantar).',
 'Disrupção': 'Atrapalha os recursos e o plano do oponente: mão (descarte), lore, mesa (voltar para a mão, travar), descarte e tinta dele, e regras que o impedem de jogar.',
 'Pressão de lore': 'Faz lore mais rápido: ganhar lore por efeito ou personagens que questam para 2 ou mais com custo efetivo baixo (custo ou Shift).',
 'Proteção / evasão': 'Mantém seus personagens vivos ou fora de alcance: Evasive, Ward, Resist, Bodyguard, não pode ser desafiado, aumentar vontade e remover dano.',
 'Corpo': 'Personagens sem nenhuma habilidade (vanilla): valem só pelos números (custo, força, vontade e lore).',
 'Outros': 'Cartas com habilidades que não se encaixam nas funções, como desvantagens do próprio personagem, regras de montagem de deck e algumas regras de location.',
}
SUBS_DESC = {
 ('Remoção', 'Em massa'): 'Atinge vários personagens de uma vez: wipe (Raging Storm, Malicious, Mean and Scary), vários alvos (Grab Your Bow) ou dano que se repete ou espalha (Wasabi).',
 ('Remoção', 'Simples'): 'Atinge um personagem escolhido.',
 ('Controle de mesa', 'Desafio'): 'Personagens feitos para desafiar: Challenger, Rush, Reckless, Alert e defesa só no seu turno (Judy Hopps – Lead Detective).',
 ('Controle de mesa', 'Força'): 'Aumenta a força dos seus personagens (inclusive Support) ou reduz a do oponente.',
 ('Controle de mesa', 'Ready'): 'Prepara personagens exauridos para questar ou desafiar de novo.',
 ('Draw', 'Card advantage'): 'Ganha cartas a mais: comprar, recuperar do descarte, buscar no deck. Personagem que compra 2 e descarta 1 conta aqui, porque ele fica na mesa (+1).',
 ('Draw', 'Filter'): 'Troca ou seleciona cartas sem ganhar a mais: comprar 1 e descartar 1, olhar o topo, e ações que só repõem a si mesmas (Strike a Good Match: compra 2, descarta 1 e vai para o descarte = 0).',
 ('Aceleração', 'Gerar ink'): 'Coloca cartas a mais no inkwell (ramp).',
 ('Aceleração', 'Gerar ink drop'): 'Gera ink drop, tinta extra de uso único.',
 ('Aceleração', 'Cortar custo'): 'Paga menos ou nada: reduzir custo, jogar de graça, Shift e cantar músicas com Singer.',
 ('Disrupção', 'Mão'): 'Ataca a mão do oponente: descarte e revelar a mão.',
 ('Disrupção', 'Lore'): 'Tira lore do oponente ou impede que ele ganhe.',
 ('Disrupção', 'Mesa'): 'Atrapalha os personagens do oponente sem tirá-los do jogo: voltar para a mão e travar (não prepara, não desafia, não questa).',
 ('Disrupção', 'Recursos'): 'Mexe no descarte ou na tinta do oponente.',
 ('Disrupção', 'Regras'): 'Impede o oponente de jogar ou cantar certas cartas.',
 ('Pressão de lore', 'Lore'): 'Ganhar lore por efeito e personagens baratos com lore alto.',
 ('Proteção / evasão', 'Evasão'): 'Difícil de ser desafiado: Evasive e não pode ser desafiado.',
 ('Proteção / evasão', 'Defesa'): 'Aguenta mais ou protege os outros: Ward, Resist, Bodyguard, aumentar vontade.',
 ('Proteção / evasão', 'Cura'): 'Remove dano dos seus personagens.',
 ('Corpo', 'Corpo'): FUNCS_DESC['Corpo'], ('Outros', 'Outros'): FUNCS_DESC['Outros'],
}
HABS_DESC = {
 'Wipe / todos os oponentes': 'Afeta todos os personagens do oponente (banir, dano, exaurir, mandar para o fundo do deck).',
 'Vários alvos': 'Afeta até 2 ou mais personagens escolhidos.',
 'Repete ou espalha dano': 'Causa dano de novo em outro personagem, como o Wasabi ao desafiar.',
 'Causar dano': 'Causa dano a um personagem escolhido.', 'Banir': 'Bane um personagem escolhido.',
 'Voltar para a mão': 'Devolve um personagem, item ou location para a mão do dono.',
 'Exaurir': 'Exaure um personagem do oponente, que fica sem poder questar ou desafiar.',
 'Mover dano': 'Move dano dos seus personagens para um do oponente.',
 'Para o inkwell ou fundo do deck': 'Manda um personagem do oponente para o inkwell dele ou para o fundo do deck.',
 'Challenger': 'Ganha força ao desafiar.', 'Rush': 'Pode desafiar no turno em que entra.', 'Reckless': 'Não questa e precisa desafiar se puder.',
 'Aumentar força': 'Dá força a mais, por efeito ou por Support, ou muda o dano do desafio (Dale – Ready for His Shot).', 'Reduzir força': 'Tira força de um personagem do oponente.',
 'Preparar': 'Prepara (ready) um personagem exaurido.', 'Travar (não prepara / desafia / questa)': 'O personagem do oponente não pode preparar, desafiar ou questar por um tempo.',
 'Compra e descarta': 'Compra e descarta a mesma quantidade (filtra a mão).', 'Olha o topo / reordena': 'Olha cartas do topo do deck e escolhe a ordem.',
 'Comprar': 'Compra cartas a mais (inclui comprar 2 e descartar 1).', 'Recuperar do descarte': 'Traz cartas do seu descarte de volta para a mão ou para o jogo.',
 'Buscar no deck': 'Procura cartas no deck e coloca na mão.', 'Ramp': 'Coloca cartas a mais no inkwell.', 'Ink drop': 'Gera ink drop.',
 'Reduzir custo': 'Diminui o custo de cartas.', 'Jogar de graça': 'Joga uma carta sem pagar tinta.', 'Shift': 'Joga por um custo menor em cima de outra versão do personagem.',
 'Cantar (Singer)': 'Canta músicas mais caras de graça.', 'Oponente descarta': 'O oponente descarta cartas da mão.', 'Revela a mão': 'Você vê a mão do oponente.',
 'Oponente perde lore': 'O oponente perde lore.', 'Impede ganhar lore': 'O oponente não pode ganhar lore.', 'Reduz lore do oponente': 'Um personagem do oponente questa para menos.',
 'Descarte do oponente': 'Tira ou mexe nas cartas do descarte do oponente.', 'Tinta do oponente': 'Mexe no inkwell do oponente.',
 'Impede jogar ou cantar': 'O oponente não pode jogar ou cantar certas cartas.', 'Ganhar lore': 'Ganha lore por efeito ou personagem questa para mais.',
 'Evasive': 'Só pode ser desafiado por personagens com Evasive.', 'Imune a desafio': 'Não pode ser desafiado (ou não sofre dano) em certas condições.',
 'Ward': 'O oponente não pode escolhê-lo como alvo de efeitos.', 'Resist': 'Recebe menos dano.', 'Bodyguard': 'Pode entrar exaurido e protege os outros de desafios.',
 'Aumentar vontade': 'Dá vontade (willpower) a mais.', 'Remover dano': 'Remove dano dos seus personagens.', 'Lore alto e barato': 'Personagem que questa para 2 ou mais com custo efetivo baixo (o menor entre o custo e o Shift): lore ÷ custo de pelo menos 2/3. Ex.: lore 2 por custo 3, lore 3 com Shift 3.',
 'Alert': 'Pode desafiar como se tivesse Evasive.', 'Bônus no seu turno': 'Ganha Resist, Ward ou vontade só durante o seu turno: é para atacar, não para se defender.', 'Repõe a si mesma': 'Ação ou música que só substitui a si mesma (comprar 1, ou comprar 2 e descartar 1): não gera carta a mais.',
 'Vanilla': FUNCS_DESC['Corpo'], 'Outros': FUNCS_DESC['Outros'],
}
MOMENTS_DESC = {
 'Ao jogar': 'Quando o personagem, item ou location entra em jogo.', 'Ação / música (ao jogar)': 'Ações e músicas: o efeito acontece quando são jogadas ou cantadas.',
 'Ao jogar outra carta': 'Sempre que você joga outra carta (por exemplo, "sempre que você jogar um personagem").', 'Ao questar': 'Sempre que o personagem questa (Support inclusive).',
 'Ao desafiar': 'Ao desafiar ou ser desafiado (Challenger inclusive).', 'Ao banir': 'Quando o personagem bane outro num desafio.', 'Ao ser banido': 'Quando o próprio personagem é banido.',
 'Ao cantar': 'Ao cantar uma música (Singer inclusive).', 'Início do turno': 'No início do seu turno.', 'Fim do turno': 'No fim do turno.',
 'Ativada (custo)': 'Você ativa pagando um custo (exaurir, tinta ou banir).', 'Contínuo': 'Sempre ativo enquanto a carta está em jogo, como o Lumiere dando +1 de força, ou palavras-chave como Evasive e Ward.',
 '—': 'Sem habilidade.',
}

ORDER = ['Remoção', 'Controle de mesa', 'Draw', 'Aceleração', 'Disrupção', 'Pressão de lore', 'Proteção / evasão', 'Corpo', 'Outros']
MOM = ['Ao jogar', 'Ação / música (ao jogar)', 'Ao jogar outra carta', 'Ao questar', 'Ao desafiar', 'Ao banir', 'Ao ser banido', 'Ao cantar', 'Início do turno', 'Fim do turno', 'Ativada (custo)', 'Contínuo', '—']

def tables():
    funcs, subs, habs = list(ORDER), [], []
    idx = lambda lst, v: lst.index(v) if v in lst else (lst.append(v) or len(lst) - 1)
    for f, s_, h, _ in RULES:
        si = idx(subs, (funcs.index(f), s_)); idx(habs, (si, h))
    for f, s_, h in [('Pressão de lore', 'Lore', 'Lore alto e barato'), ('Corpo', 'Corpo', 'Vanilla'), ('Outros', 'Outros', 'Outros')]:
        si = idx(subs, (funcs.index(f), s_)); idx(habs, (si, h))
    tax = {'funcs': funcs, 'subs': [[f, l] for f, l in subs], 'habs': [[s_, l] for s_, l in habs], 'moments': MOM,
           'desc': {'funcs': [FUNCS_DESC.get(f, '') for f in funcs], 'subs': [SUBS_DESC.get((funcs[f], l), '') for f, l in subs],
                    'habs': [HABS_DESC.get(l, '') for _, l in habs], 'moments': [MOMENTS_DESC.get(m, '') for m in MOM]}}
    def fx_of(out):
        r = set()
        for f, s_, h, mo, _ in out:
            si = subs.index((funcs.index(f), s_)); r.add((habs.index((si, h)), MOM.index(mo)))
        return sorted(r)
    return tax, fx_of

def main(root=Path(__file__).resolve().parent.parent):
    cat = json.loads((root / 'data' / 'catalog.json').read_text())
    tax, fx_of = tables()
    by_ident = {}
    for p in sorted(cat['products'], key=lambda p: not p.get('text')):  # prefer a printing that has the text
        if not p.get('cardType'): continue
        ident = identity(p['name'])
        if ident in by_ident and by_ident[ident]: continue
        by_ident[ident] = fx_of(classify_product(p)[2])
    out = root / 'site' / 'data' / 'functions.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({**tax, 'byIdent': by_ident}, ensure_ascii=False, separators=(',', ':')))
    print('functions.json:', len(by_ident), 'cards')

if __name__ == '__main__':
    main()
