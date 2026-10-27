from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def component_source(name):
    return '\n'.join(p.read_text() for p in sorted((ROOT/'site/src'/name).glob('*.js')))
