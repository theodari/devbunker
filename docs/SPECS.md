# DevBunker - Spécifications Techniques

## 1. Vision du projet

**DevBunker** est un fork d'[OpenCode](https://github.com/anomalyco/opencode) (v1.2.21, MIT License)
transformé en agent de développement IA **air-gapped au niveau LLM** : toute l'inférence
est locale (Ollama, LM Studio, vLLM), tandis que l'accès réseau reste disponible pour
la recherche web, git et d'autres usages légitimes.

DevBunker intègre nativement la méthodologie **BMAD** (Business-Minded Agile Development)
couplée à une démarche **TDD-first** où les tests sont générés depuis les spécifications
**avant** l'implémentation, garantissant l'objectivité et la conformité du code aux exigences.

### Public cible

- Développeurs travaillant en environnement confidentiel ou contraint (défense, santé, finance)
- Développeurs soucieux de la confidentialité de leur code source
- Équipes souhaitant une toolchain IA complète sans dépendance cloud
- Projet open source (licence MIT)

---

## 2. Base technique

| Élément         | Détail                                          |
|-----------------|------------------------------------------------ |
| Fork de         | `anomalyco/opencode` v1.2.21                    |
| Licence         | MIT                                             |
| Langage         | TypeScript (monorepo Bun)                       |
| TUI             | SolidJS + @opentui/solid                        |
| Architecture    | Client/serveur HTTP + SSE                       |
| Stockage        | SQLite (sessions, état)                         |
| Desktop         | Tauri (phase ultérieure)                        |

### Dépendances conservées d'OpenCode

- Système de tools (Read, Write, Edit, Grep, Glob, Bash, WebFetch, Todo, Task)
- Intégration MCP (stdio + HTTP/SSE)
- Système de plugins (`@opencode-ai/plugin`)
- Système d'agents (configs nommées : prompt, modèle, permissions)
- SDK REST (OpenAPI 3.1)
- TUI complète

---

## 3. Architecture cible

```
DevBunker
├── packages/
│   ├── devbunker/              (fork de packages/opencode)
│   │   ├── src/
│   │   │   ├── provider/       Provider lock (local uniquement)
│   │   │   ├── tool/           Shell guard, filesystem scope
│   │   │   ├── guard/          NOUVEAU : git-guard, secret-scan
│   │   │   ├── ram/            NOUVEAU : détection RAM, filtrage modèles
│   │   │   ├── agent/          Agents modifiés
│   │   │   ├── config/         Config étendue
│   │   │   ├── server/         Serveur HTTP inchangé
│   │   │   ├── session/        Sessions inchangées
│   │   │   └── ...
│   │   └── package.json
│   │
│   ├── bmad/                   NOUVEAU : méthodologie BMAD + TDD
│   │   ├── agents/             Définitions d'agents BMAD
│   │   ├── tasks/              Tâches automatisées
│   │   ├── templates/          Templates de documents
│   │   └── tdd/                Orchestration TDD-first
│   │
│   ├── sdk/                    SDK REST (conservé)
│   └── plugin/                 Système de plugins (conservé)
│
├── devbunker.json              Configuration par défaut
├── LICENSE                     MIT
└── README.md
```

---

## 4. Provider Lock — Inférence locale uniquement

### Principe

Le fichier `provider.ts` d'OpenCode contient un `BUNDLED_PROVIDERS` map avec tous les
providers cloud (Anthropic, OpenAI, Google, AWS Bedrock, etc.). DevBunker **supprime
tous les providers cloud** et ne conserve que les providers compatibles avec une
inférence locale.

### Providers autorisés

| Provider              | Backend             | Protocole           |
|-----------------------|---------------------|---------------------|
| Ollama                | ollama              | OpenAI-compatible   |
| LM Studio             | lmstudio            | OpenAI-compatible   |
| vLLM                  | vllm                | OpenAI-compatible   |
| llama.cpp (server)    | llamacpp            | OpenAI-compatible   |
| LocalAI               | localai             | OpenAI-compatible   |
| Tout OpenAI-compatible| custom              | OpenAI-compatible   |

Tous utilisent le SDK `@ai-sdk/openai-compatible` pointant vers `localhost` ou une
adresse réseau locale configurable.

### Détection RAM et filtrage des modèles

DevBunker détecte la RAM disponible au démarrage et filtre dynamiquement les modèles
proposés à l'utilisateur.

#### Règles de filtrage

| RAM disponible | Modèles autorisés (approximation)        |
|----------------|------------------------------------------|
| < 8 Go         | Modèles ≤ 3B paramètres (Q4)             |
| 8-16 Go        | Modèles ≤ 8B paramètres (Q4)             |
| 16-32 Go       | Modèles ≤ 14B paramètres (Q4/Q5)         |
| 32-64 Go       | Modèles ≤ 32B paramètres (Q4/Q5)         |
| 64-128 Go      | Modèles ≤ 70B paramètres (Q4)            |
| > 128 Go       | Tous les modèles                         |

#### Comportement UI

- Les modèles compatibles avec la RAM sont affichés normalement
- Les modèles trop gourmands sont **grisés** avec indication de la RAM requise
- L'utilisateur peut forcer le chargement d'un modèle grisé (à ses risques)
- La RAM est réévaluée périodiquement (un autre processus peut libérer de la mémoire)

#### Implémentation

```typescript
// packages/devbunker/src/ram/detector.ts
interface SystemRAM {
  total: number;        // RAM totale en Go
  available: number;    // RAM disponible en Go
  gpuVram?: number;     // VRAM GPU si détectable
}

// packages/devbunker/src/ram/model-filter.ts
interface ModelRequirement {
  name: string;
  params: string;       // ex: "7B", "32B"
  quantization: string; // ex: "Q4_K_M", "Q5_K_M"
  ramRequired: number;  // RAM minimale estimée en Go
}
```

---

## 5. Sécurité — Guards

### 5.1 Filesystem Scope

**Principe** : Tout accès fichier (Read, Write, Edit, Glob, Grep) est restreint à un
unique dossier workspace configuré au lancement.

#### Règles

- Le workspace est défini dans `devbunker.json` ou par argument CLI
- Tous les chemins sont résolus en absolu avant vérification
- Les symlinks sont résolus et vérifiés (pas de symlink pointant hors du workspace)
- Accès interdit à : `~/.ssh/`, `~/.env`, `~/.config/`, `~/.gnupg/`, etc.
- Les fichiers `.env`, `*.pem`, `*.key` dans le workspace déclenchent un avertissement

### 5.2 Git Guard

**Principe** : Contrôle des opérations Git pour éviter l'exfiltration accidentelle de code.

#### Mode contrôlé (remote whitelist)

```json
// devbunker.json
{
  "git": {
    "mode": "controlled",
    "allowedRemotes": [
      "git@github.com:mon-org/*",
      "https://gitlab.internal.corp/*"
    ],
    "blockForce": true,
    "secretScan": true
  }
}
```

#### Matrice des opérations

| Opération              | Comportement                                      |
|------------------------|---------------------------------------------------|
| `git commit`           | Autorisé librement                                |
| `git push`             | Autorisé uniquement vers remotes en whitelist      |
| `git push --force`     | Bloqué (configurable)                             |
| `git remote add`       | Confirmation obligatoire + vérification whitelist  |
| `git remote set-url`   | Confirmation obligatoire + vérification whitelist  |
| `git clone`            | Autorisé (dans le workspace uniquement)            |
| `git pull`             | Autorisé                                          |
| `git config --global`  | Bloqué                                            |

#### Scan de secrets (pre-push)

Avant chaque `git push` autorisé, DevBunker scanne le diff pour détecter :
- Clés API (patterns connus : `sk-`, `AKIA`, `ghp_`, etc.)
- Tokens JWT
- Mots de passe en dur (heuristique)
- Fichiers sensibles (.env, *.pem, *.key, *.p12)

Si un secret est détecté, le push est bloqué avec explication.

### 5.3 Shell Guard

**Principe** : Le BashTool filtre les commandes selon trois niveaux : autorisé,
confirmation requise, bloqué.

#### Commandes autorisées (whitelist)

```
# Build
make, cmake, cargo build, go build, npm run build, dotnet build, qmake, bun build

# Test / TDD
npm test, pytest, go test, cargo test, jest, vitest, dotnet test, bun test

# Package management
npm install, pip install, cargo add, go get, bun add, bun install

# Linting / Formatting
eslint, prettier, black, rustfmt, clang-format, biome

# Navigation (lecture seule)
ls, find, cat, head, tail, wc, tree, pwd, which, file, stat

# Git (opérations courantes)
git status, git log, git diff, git add, git commit,
git branch, git checkout, git switch, git merge, git pull,
git stash, git rebase, git cherry-pick, git tag, git show

# Docker
docker build, docker run, docker compose up, docker compose down,
docker ps, docker logs, docker images
```

#### Commandes à confirmation

```
# Git distant
git push                    # Contrôlé par Git Guard
git remote add/set-url      # Modification de destination

# Destructif local
rm -rf                      # Suppression récursive
git reset --hard            # Perte de modifications

# Réseau
curl, wget                  # Téléchargement/upload
docker pull                 # Téléchargement d'images

# Élévation
sudo *                      # Tout ce qui est sudo

# Nettoyage
docker system prune         # Suppression massive
```

#### Commandes bloquées

```
# Exfiltration réseau
ssh, scp, rsync (distant)
nc, netcat, ncat
telnet, ftp

# Force sur distant
git push --force, git push -f

# Hors périmètre
Toute commande accédant à des fichiers hors du workspace

# Contournement
eval, exec
Pipes vers sh, bash, zsh, cmd, powershell
```

#### Limites connues

Le Shell Guard opère au niveau des commandes directes. Un script Python ou Node
exécuté via le shell peut contenir des appels réseau ou système non détectés.
En environnement haute sécurité, le réseau doit être contrôlé au niveau OS/firewall.
DevBunker est une **couche de protection applicative**, pas un sandbox système.

---

## 6. MCPs intégrés

| MCP             | Fonction                          | Scope / Restriction          |
|-----------------|-----------------------------------|------------------------------|
| **Filesystem**  | Lecture/écriture de fichiers      | Scopé au workspace unique    |
| **Git**         | Opérations Git                    | Via Git Guard                |
| **Shell/Bash**  | Exécution de commandes            | Via Shell Guard              |
| **Web Search**  | Recherche d'informations en ligne | Activé                       |
| **Web Fetch**   | Lecture de pages web              | Activé                       |
| **SQLite**      | Base de données locale            | Fichiers dans le workspace   |
| **Docker**      | Build et run de conteneurs        | Via Shell Guard              |
| **LSP**         | Intelligence de code              | Hérité d'OpenCode            |

---

## 7. Méthodologie BMAD + TDD-First

### 7.1 Agents BMAD

DevBunker embarque des agents spécialisés correspondant aux rôles BMAD.
Chaque agent a son propre system prompt, ses outils autorisés et son modèle préféré.

| Agent        | Rôle                                     | Outils principaux           |
|--------------|------------------------------------------|-----------------------------|
| **analyst**  | Élicitation, specs, user stories         | Read, WebSearch, WebFetch   |
| **architect**| Architecture, design technique           | Read, Write, Glob, Grep    |
| **qa**       | Génération de tests depuis les specs     | Read, Write, Shell (test)   |
| **dev**      | Implémentation (fait passer les tests)   | Read, Write, Edit, Shell    |
| **po**       | Validation, critères d'acceptation       | Read, Shell (test)          |
| **pm**       | Planification, suivi                     | Read, Write                 |
| **sm**       | Facilitation, rétrospective              | Read, Write                 |

### 7.2 Workflow TDD-First from Specs

Le workflow central de DevBunker garantit que les tests sont écrits **avant**
l'implémentation et **depuis les spécifications**, pas depuis le code.

```
Phase 1 : SPECIFICATION (Agent: analyst → architect)
    ├── Élicitation des besoins utilisateur
    ├── Rédaction des user stories avec critères d'acceptation
    ├── Design technique et choix d'architecture
    └── Output : document de specs + architecture

Phase 2 : TEST GENERATION (Agent: qa)
    ├── Lecture des specs et critères d'acceptation
    ├── Génération des tests unitaires
    ├── Génération des tests d'intégration
    ├── Génération des tests d'acceptation (e2e si pertinent)
    └── Output : suite de tests complète, tous en échec (RED)

    IMPORTANT : L'agent QA n'a JAMAIS accès au code d'implémentation.
    Il travaille UNIQUEMENT depuis les documents de specs.
    Cela garantit l'objectivité des tests et évite le biais
    de conformité (adapter les tests au code plutôt qu'aux specs).

Phase 3 : RED (Vérification)
    ├── Exécution de tous les tests
    ├── Confirmation : 100% des tests échouent
    └── Si des tests passent → anomalie à investiguer

Phase 4 : IMPLEMENTATION (Agent: dev)
    ├── Lecture des specs + tests existants
    ├── Implémentation itérative
    ├── Objectif : faire passer les tests un par un
    └── Output : code d'implémentation

Phase 5 : GREEN (Validation)
    ├── Exécution de tous les tests
    ├── Confirmation : 100% des tests passent
    └── Si des tests échouent → correction de l'implémentation (pas des tests)

Phase 6 : REFACTOR (Agent: dev, supervisé par qa)
    ├── Simplification du code sans casser les tests
    ├── Extraction de patterns, nettoyage
    ├── Les tests restent inchangés et passent toujours
    └── Output : code propre et testé

Phase 7 : ACCEPTANCE (Agent: po)
    ├── Revue des critères d'acceptation
    ├── Validation fonctionnelle
    └── Output : story validée ou retour en phase 4
```

### 7.3 Implémentation technique du workflow TDD

```typescript
// packages/bmad/tdd/spec-to-test.ts
// Génère des tests depuis un document de spécifications
interface TestGenerationConfig {
  specFile: string;           // Chemin vers le doc de specs
  testFramework: string;      // jest, vitest, pytest, cargo test, etc.
  language: string;           // typescript, python, rust, go, etc.
  outputDir: string;          // Dossier de sortie des tests
  coverageTargets?: {
    statements: number;       // ex: 80
    branches: number;         // ex: 75
    functions: number;        // ex: 90
  };
}

// packages/bmad/tdd/test-runner.ts
// Orchestre le cycle red/green/refactor
interface TDDPhase {
  phase: "red" | "green" | "refactor";
  testResults: TestResult[];
  allPassing: boolean;
  coverage?: CoverageReport;
}

// packages/bmad/tdd/coverage.ts
// Suivi de la couverture de code
interface CoverageReport {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  uncoveredFiles: string[];
}
```

### 7.4 Tasks BMAD intégrées

Tâches automatisées disponibles via commandes slash :

| Commande                  | Description                                         |
|---------------------------|-----------------------------------------------------|
| `/create-story`           | Créer une user story depuis les besoins             |
| `/review-story`           | Revue qualité d'une user story                      |
| `/test-design`            | Générer le plan de tests depuis les specs           |
| `/generate-tests`         | Générer le code des tests (TDD phase RED)           |
| `/implement`              | Implémenter pour faire passer les tests (GREEN)     |
| `/qa-gate`                | Vérifier que tous les tests passent                 |
| `/refactor`               | Refactorer sans casser les tests                    |
| `/create-doc`             | Générer la documentation                            |
| `/validate-next-story`    | Valider la story courante et préparer la suivante   |
| `/trace-requirements`     | Traçabilité specs → tests → code                   |

---

## 8. Configuration

### Fichier `devbunker.json` (racine du workspace)

```json
{
  "provider": {
    "type": "ollama",
    "baseURL": "http://localhost:11434/v1",
    "defaultModel": "qwen3:32b"
  },
  "workspace": {
    "root": "/home/user/projects",
    "allowSymlinks": false
  },
  "git": {
    "mode": "controlled",
    "allowedRemotes": [],
    "blockForce": true,
    "secretScan": true
  },
  "shell": {
    "mode": "whitelist",
    "customAllowed": [],
    "customBlocked": []
  },
  "bmad": {
    "tddFirst": true,
    "defaultTestFramework": "vitest",
    "defaultLanguage": "typescript",
    "coverageTargets": {
      "statements": 80,
      "branches": 75,
      "functions": 90
    }
  }
}
```

---

## 9. Phases de développement

| Phase | Contenu                                            | Dépendances |
|-------|----------------------------------------------------|-------------|
| **P0** | Fork OpenCode, renommage DevBunker, provider lock, détection RAM, filtrage modèles | Aucune |
| **P1** | Shell Guard, Filesystem Scope, Git Guard (whitelist + secret scan) | P0 |
| **P2** | Agents BMAD, workflow TDD-first, tasks slash commands | P0 |
| **P3** | Documentation utilisateur, README, guide de démarrage, CI/CD | P0-P2 |
| **P4** | Application Desktop Tauri (optionnel) | P0-P3 |

### P0 — Fondation (estimé : premier livrable)

1. Forker `anomalyco/opencode` dans `github.com/theodari/devbunker` (ou org dédiée)
2. Renommer le package : opencode → devbunker
3. Supprimer tous les providers cloud du `BUNDLED_PROVIDERS`
4. Implémenter le module `ram/detector.ts`
5. Implémenter le module `ram/model-filter.ts`
6. Adapter l'UI pour griser les modèles incompatibles
7. Tester avec Ollama + modèle local

### P1 — Sécurité

1. Implémenter `guard/filesystem-scope.ts` — vérification de chemins
2. Implémenter `guard/shell-guard.ts` — whitelist/confirm/block
3. Implémenter `guard/git-guard.ts` — remote whitelist
4. Implémenter `guard/secret-scan.ts` — détection de secrets dans les diffs
5. Intégrer les guards dans les tools existants (BashTool, ReadTool, WriteTool, etc.)
6. Tests unitaires pour chaque guard

### P2 — BMAD + TDD

1. Créer les définitions d'agents BMAD (system prompts, permissions, modèles)
2. Implémenter `bmad/tdd/spec-to-test.ts`
3. Implémenter `bmad/tdd/test-runner.ts`
4. Implémenter `bmad/tdd/coverage.ts`
5. Créer les templates de documents (specs, stories, test plans)
6. Implémenter les slash commands
7. Tests d'intégration du workflow complet

### P3 — Documentation et distribution

1. README.md complet
2. Guide de démarrage rapide
3. Documentation des agents et tasks
4. Guide de configuration
5. CI/CD GitHub Actions (build, test, release)
6. Packaging (npm, binaires standalone)

---

## 10. Considérations techniques

### Performance

- Le contexte des modèles locaux est souvent limité (4K-32K par défaut dans Ollama)
- DevBunker doit configurer automatiquement un contexte suffisant (minimum 32K recommandé)
- Le chunking des fichiers longs doit être géré côté agent

### Compatibilité modèles

- Tous les modèles ne supportent pas le tool calling (function calling)
- DevBunker doit détecter les capacités du modèle et adapter le prompting
- Fallback vers un mode "prompt-only" si le tool calling n'est pas supporté

### Multi-plateforme

- Windows, macOS, Linux
- La détection RAM et VRAM doit fonctionner sur les trois plateformes
- Le Shell Guard doit gérer les différences de commandes (bash vs powershell)
