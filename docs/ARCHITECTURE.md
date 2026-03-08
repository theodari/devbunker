# DevBunker - Architecture

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                        DevBunker                                │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │   TUI    │  │ Desktop  │  │  Web App │  │   IDE    │       │
│  │(Terminal)│  │ (Tauri)  │  │          │  │Extension │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │             │
│       └──────────────┴──────┬───────┴──────────────┘             │
│                             │                                   │
│                    HTTP + SSE (port 4096)                        │
│                             │                                   │
│  ┌──────────────────────────┴──────────────────────────────┐    │
│  │                    Serveur DevBunker                     │    │
│  │                                                         │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │              Agent Loop                          │    │    │
│  │  │                                                  │    │    │
│  │  │  ┌────────────┐    ┌─────────────┐              │    │    │
│  │  │  │  Provider   │    │   Session    │              │    │    │
│  │  │  │  (Local)    │    │  Manager     │              │    │    │
│  │  │  └──────┬─────┘    └─────────────┘              │    │    │
│  │  │         │                                        │    │    │
│  │  │         ▼                                        │    │    │
│  │  │  ┌──────────────┐                               │    │    │
│  │  │  │ RAM Detector  │                               │    │    │
│  │  │  │ Model Filter  │                               │    │    │
│  │  │  └──────────────┘                               │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  │                                                         │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │              Tool System                         │    │    │
│  │  │                                                  │    │    │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ │    │    │
│  │  │  │  Read   │ │ Write  │ │  Edit  │ │   Glob   │ │    │    │
│  │  │  └───┬────┘ └───┬────┘ └───┬────┘ └────┬─────┘ │    │    │
│  │  │      │          │          │            │        │    │    │
│  │  │      └──────────┴─────┬────┴────────────┘        │    │    │
│  │  │                       │                          │    │    │
│  │  │              ┌────────▼────────┐                 │    │    │
│  │  │              │ Filesystem Scope │                 │    │    │
│  │  │              │     Guard        │                 │    │    │
│  │  │              └─────────────────┘                 │    │    │
│  │  │                                                  │    │    │
│  │  │  ┌────────┐ ┌────────────┐ ┌──────────────────┐ │    │    │
│  │  │  │  Bash  │ │  Git ops   │ │  WebSearch/Fetch │ │    │    │
│  │  │  └───┬────┘ └─────┬──────┘ └──────────────────┘ │    │    │
│  │  │      │            │                              │    │    │
│  │  │  ┌───▼────┐ ┌─────▼──────┐                      │    │    │
│  │  │  │ Shell  │ │  Git Guard │                      │    │    │
│  │  │  │ Guard  │ │ + Secret   │                      │    │    │
│  │  │  │        │ │   Scan     │                      │    │    │
│  │  │  └────────┘ └────────────┘                      │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  │                                                         │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │              MCP Servers                         │    │    │
│  │  │                                                  │    │    │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ │    │    │
│  │  │  │SQLite  │ │ Docker │ │  LSP   │ │ Plugins  │ │    │    │
│  │  │  └────────┘ └────────┘ └────────┘ └──────────┘ │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  │                                                         │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │              BMAD Engine                         │    │    │
│  │  │                                                  │    │    │
│  │  │  ┌──────────────────────────────────────────┐   │    │    │
│  │  │  │           Agent Definitions               │   │    │    │
│  │  │  │  analyst │ architect │ qa │ dev │ po │ pm │   │    │    │
│  │  │  └──────────────────────────────────────────┘   │    │    │
│  │  │                                                  │    │    │
│  │  │  ┌──────────────────────────────────────────┐   │    │    │
│  │  │  │           TDD-First Engine                │   │    │    │
│  │  │  │                                           │   │    │    │
│  │  │  │  spec-to-test → RED → implement → GREEN  │   │    │    │
│  │  │  │            → REFACTOR → ACCEPT            │   │    │    │
│  │  │  └──────────────────────────────────────────┘   │    │    │
│  │  │                                                  │    │    │
│  │  │  ┌──────────────────────────────────────────┐   │    │    │
│  │  │  │           Tasks & Templates               │   │    │    │
│  │  │  │  /create-story  /generate-tests           │   │    │    │
│  │  │  │  /implement     /qa-gate                  │   │    │    │
│  │  │  │  /refactor      /trace-requirements       │   │    │    │
│  │  │  └──────────────────────────────────────────┘   │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    SQLite Storage                        │    │
│  │              (sessions, state, config)                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ OpenAI-compatible API
                              ▼
                 ┌──────────────────────────┐
                 │     Local LLM Backend    │
                 │                          │
                 │  ┌────────┐ ┌─────────┐ │
                 │  │ Ollama │ │LM Studio│ │
                 │  └────────┘ └─────────┘ │
                 │  ┌────────┐ ┌─────────┐ │
                 │  │  vLLM  │ │llama.cpp│ │
                 │  └────────┘ └─────────┘ │
                 └──────────────────────────┘
```

## Flux de données

### Requête utilisateur standard

```
Utilisateur (TUI)
    │
    ▼
Serveur HTTP ──► Session Manager ──► Agent Loop
                                         │
                                         ├── Sélection du modèle
                                         │   (filtré par RAM)
                                         │
                                         ├── Envoi au Provider Local
                                         │   (Ollama localhost:11434)
                                         │
                                         ├── Réponse du modèle
                                         │   (peut inclure tool calls)
                                         │
                                         ├── Exécution des tools
                                         │   │
                                         │   ├── Guards vérifient
                                         │   │   chaque opération
                                         │   │
                                         │   └── Résultat retourné
                                         │       au modèle
                                         │
                                         └── Réponse finale ──► TUI
```

### Workflow TDD-First

```
/create-story (analyst)
    │
    ▼
Document de specs (user story + critères d'acceptation)
    │
    ▼
/generate-tests (qa)                    ◄── N'a PAS accès au code source
    │
    ▼
Suite de tests (tous en RED)
    │
    ▼
/qa-gate ──► Vérifie : 100% tests échouent ──► OK
    │
    ▼
/implement (dev)                        ◄── A accès aux tests + specs
    │
    ├── Itération : implémente → run tests → corrige
    │
    ▼
/qa-gate ──► Vérifie : 100% tests passent ──► OK
    │
    ▼
/refactor (dev, supervisé par qa)
    │
    ├── Refactore → run tests → vérifie non-régression
    │
    ▼
/qa-gate ──► Vérifie : 100% tests passent encore ──► OK
    │
    ▼
Validation PO (po)
    │
    ▼
Story terminée ──► /validate-next-story
```

## Isolation des agents BMAD (TDD-First)

L'isolation entre les agents est cruciale pour le workflow TDD-first :

```
┌─────────────────────────────────────────────────┐
│                                                 │
│   Agent QA (génération de tests)                │
│                                                 │
│   PEUT LIRE :                                   │
│   ├── docs/specs/*.md                           │
│   ├── docs/stories/*.md                         │
│   ├── docs/architecture/*.md                    │
│   └── tests/ (ses propres tests générés)        │
│                                                 │
│   NE PEUT PAS LIRE :                            │
│   ├── src/ (code source)                        │
│   ├── lib/ (bibliothèques internes)             │
│   └── Tout fichier d'implémentation             │
│                                                 │
│   PEUT EXÉCUTER :                               │
│   └── Commandes de test uniquement              │
│                                                 │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                                                 │
│   Agent Dev (implémentation)                    │
│                                                 │
│   PEUT LIRE :                                   │
│   ├── docs/specs/*.md                           │
│   ├── docs/stories/*.md                         │
│   ├── docs/architecture/*.md                    │
│   ├── tests/ (tests générés par QA)             │
│   └── src/ (code source)                        │
│                                                 │
│   NE PEUT PAS MODIFIER :                        │
│   └── tests/ (les tests sont intouchables)      │
│                                                 │
│   PEUT EXÉCUTER :                               │
│   └── Build + test commands                     │
│                                                 │
└─────────────────────────────────────────────────┘
```

Cette séparation est le coeur de l'objectivité TDD-first :
l'agent qui écrit les tests ne voit jamais le code,
et l'agent qui écrit le code ne peut pas modifier les tests.
