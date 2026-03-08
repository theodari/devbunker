# DevBunker - Méthodologie BMAD + TDD-First

## 1. Principe fondamental

> **Les tests sont écrits AVANT le code, par un agent qui n'a JAMAIS vu l'implémentation.**

Ce principe résout le biais classique du développement assisté par IA :
quand le même agent écrit le code et les tests, il tend à écrire des tests
qui valident ce qu'il a codé, plutôt que ce qui était demandé.

Dans DevBunker, la séparation est structurelle et non optionnelle.

## 2. Rôles des agents

### Analyst (Élicitation)

**Objectif** : Transformer les besoins bruts en spécifications exploitables.

**Entrées** : Description informelle du besoin utilisateur.

**Sorties** :
- Document de spécifications (`docs/specs/`)
- User stories avec critères d'acceptation (`docs/stories/`)
- Glossaire métier si nécessaire

**System prompt (résumé)** :
> Tu es un analyste métier. Tu élicites les besoins, identifies les cas limites,
> et rédiges des user stories avec des critères d'acceptation précis et testables.
> Tu poses des questions pour clarifier les ambiguïtés.

**Accès fichiers** : Lecture seule sur tout le workspace.
**Commandes** : Aucune.

---

### Architect (Conception)

**Objectif** : Définir l'architecture technique à partir des specs.

**Entrées** : Documents de specs, stories.

**Sorties** :
- Document d'architecture (`docs/architecture/`)
- Diagrammes (Mermaid dans le markdown)
- Choix technologiques documentés
- Structure de fichiers proposée

**System prompt (résumé)** :
> Tu es un architecte logiciel. Tu conçois des architectures simples, modulaires
> et testables. Tu documentes tes choix et leurs justifications. Tu anticipes
> les besoins de testabilité (injection de dépendances, interfaces, etc.).

**Accès fichiers** : Lecture/écriture dans `docs/` uniquement.
**Commandes** : Aucune.

---

### QA (Génération de tests)

**Objectif** : Écrire les tests DEPUIS les specs, SANS voir le code.

**Entrées** : Documents de specs, stories, architecture.

**Sorties** :
- Tests unitaires (`tests/unit/`)
- Tests d'intégration (`tests/integration/`)
- Tests d'acceptation (`tests/acceptance/`)
- Plan de test (`docs/test-plans/`)

**System prompt (résumé)** :
> Tu es un ingénieur QA. Tu écris des tests UNIQUEMENT à partir des
> spécifications et des critères d'acceptation. Tu n'as PAS accès au code
> source et tu ne dois JAMAIS demander à le voir. Tes tests doivent :
> - Couvrir chaque critère d'acceptation
> - Inclure les cas limites identifiés dans les specs
> - Être indépendants les uns des autres
> - Utiliser des noms descriptifs qui reflètent le comportement attendu
> - Suivre le pattern Arrange/Act/Assert

**Accès fichiers** :
- LECTURE : `docs/specs/`, `docs/stories/`, `docs/architecture/`, `docs/test-plans/`
- ÉCRITURE : `tests/`, `docs/test-plans/`
- INTERDIT : `src/`, `lib/`, tout fichier d'implémentation

**Commandes** : Uniquement les commandes de test (npm test, pytest, etc.).

---

### Dev (Implémentation)

**Objectif** : Écrire le code qui fait passer les tests.

**Entrées** : Specs, architecture, tests existants (RED).

**Sorties** :
- Code source (`src/`, `lib/`)
- Configuration de build si nécessaire

**System prompt (résumé)** :
> Tu es un développeur. Tu implémentes le code nécessaire pour faire passer
> les tests existants. Tu NE MODIFIES JAMAIS les tests. Si un test te semble
> incorrect, signale-le mais ne le change pas. Tu travailles de manière
> itérative : fais passer les tests un par un. Garde le code simple.

**Accès fichiers** :
- LECTURE : `docs/`, `tests/`, `src/`, `lib/`
- ÉCRITURE : `src/`, `lib/`, fichiers de config (package.json, tsconfig, etc.)
- INTERDIT EN ÉCRITURE : `tests/`

**Commandes** : Build + test.

---

### PO (Product Owner - Validation)

**Objectif** : Valider que l'implémentation répond aux besoins.

**Entrées** : Specs, stories, résultats de tests, code.

**Sorties** :
- Validation ou rejet avec feedback
- Mise à jour du statut des stories

**System prompt (résumé)** :
> Tu es le Product Owner. Tu valides que l'implémentation satisfait les
> critères d'acceptation de chaque story. Tu exécutes les tests et vérifies
> les résultats. Tu peux rejeter une story avec un feedback précis.

**Accès fichiers** : Lecture sur tout le workspace.
**Commandes** : Uniquement les commandes de test.

---

### PM (Project Manager)

**Objectif** : Planifier et suivre l'avancement.

**Entrées** : Stories, statuts, historique.

**Sorties** :
- Plan de sprint (`docs/sprints/`)
- Rapports d'avancement

**Accès fichiers** : Lecture/écriture dans `docs/` uniquement.
**Commandes** : Aucune.

---

### SM (Scrum Master)

**Objectif** : Faciliter le processus, identifier les blocages.

**Entrées** : Logs de session, statuts, feedback.

**Sorties** :
- Recommandations de processus
- Rétrospectives

**Accès fichiers** : Lecture/écriture dans `docs/` uniquement.
**Commandes** : Aucune.

---

## 3. Workflow détaillé

### Étape 1 : Créer une story (`/create-story`)

```
Utilisateur : "Je veux un système d'authentification avec email/mot de passe"

Agent Analyst :
    1. Pose des questions de clarification
       - "Faut-il gérer la réinitialisation de mot de passe ?"
       - "Quelles sont les règles de complexité du mot de passe ?"
       - "Faut-il un mécanisme de verrouillage après N tentatives ?"

    2. Rédige la story
       ┌──────────────────────────────────────────────────────┐
       │ STORY: Authentification par email/mot de passe       │
       │                                                      │
       │ En tant qu'utilisateur,                              │
       │ je veux me connecter avec mon email et mot de passe, │
       │ afin d'accéder à mon espace personnel.               │
       │                                                      │
       │ CRITÈRES D'ACCEPTATION :                             │
       │ ☐ CA1: Un utilisateur peut s'inscrire avec un email  │
       │        valide et un mot de passe ≥ 8 caractères      │
       │ ☐ CA2: Un email déjà utilisé est rejeté              │
       │ ☐ CA3: Un utilisateur inscrit peut se connecter      │
       │ ☐ CA4: Un mot de passe incorrect est rejeté          │
       │ ☐ CA5: Après 5 échecs, le compte est verrouillé 15mn│
       │ ☐ CA6: Les mots de passe sont hashés (bcrypt)       │
       │ ☐ CA7: Un token JWT est retourné à la connexion     │
       └──────────────────────────────────────────────────────┘

    3. Sauvegarde : docs/stories/auth-email-password.md
```

### Étape 2 : Design architecture (`/architect`)

```
Agent Architect :
    1. Lit la story + toutes les stories existantes
    2. Propose l'architecture

       ┌──────────────────────────────────────────────────────┐
       │ ARCHITECTURE : Module Auth                           │
       │                                                      │
       │ src/                                                 │
       │ ├── auth/                                            │
       │ │   ├── auth.service.ts      (logique métier)        │
       │ │   ├── auth.controller.ts   (endpoints HTTP)        │
       │ │   ├── auth.types.ts        (interfaces/types)      │
       │ │   ├── password.hasher.ts   (bcrypt wrapper)        │
       │ │   ├── token.service.ts     (JWT generation)        │
       │ │   └── lockout.service.ts   (gestion verrouillage)  │
       │ │                                                    │
       │ Choix techniques :                                   │
       │ - bcrypt pour le hashing (cost factor 12)            │
       │ - JWT RS256 pour les tokens                          │
       │ - Injection de dépendances via interfaces            │
       │   (testabilité)                                      │
       └──────────────────────────────────────────────────────┘

    3. Sauvegarde : docs/architecture/auth-module.md
```

### Étape 3 : Générer les tests (`/generate-tests`)

```
Agent QA :
    1. Lit UNIQUEMENT :
       - docs/stories/auth-email-password.md
       - docs/architecture/auth-module.md

    2. NE LIT PAS src/ (le dossier est interdit)

    3. Génère les tests pour chaque critère d'acceptation

       ┌──────────────────────────────────────────────────────┐
       │ tests/unit/auth.service.test.ts                      │
       │                                                      │
       │ describe("AuthService - Registration")               │
       │   ✎ CA1: should register user with valid email       │
       │          and password >= 8 chars                      │
       │   ✎ CA1: should reject registration with             │
       │          password < 8 chars                           │
       │   ✎ CA1: should reject registration with             │
       │          invalid email format                         │
       │   ✎ CA2: should reject registration with             │
       │          already used email                           │
       │   ✎ CA6: should store password as bcrypt hash        │
       │                                                      │
       │ describe("AuthService - Login")                      │
       │   ✎ CA3: should login with correct credentials       │
       │   ✎ CA4: should reject login with wrong password     │
       │   ✎ CA5: should lock account after 5 failed attempts │
       │   ✎ CA5: should unlock account after 15 minutes      │
       │   ✎ CA7: should return valid JWT on successful login  │
       │                                                      │
       │ describe("PasswordHasher")                           │
       │   ✎ should hash password with bcrypt                 │
       │   ✎ should verify correct password                   │
       │   ✎ should reject incorrect password                 │
       │                                                      │
       │ describe("TokenService")                             │
       │   ✎ should generate valid JWT with user claims       │
       │   ✎ should set expiration on token                   │
       └──────────────────────────────────────────────────────┘

    4. Sauvegarde : tests/unit/auth.service.test.ts
                    tests/unit/password.hasher.test.ts
                    tests/unit/token.service.test.ts
```

### Étape 4 : Vérifier la phase RED (`/qa-gate`)

```
Exécution : npm test

RÉSULTAT ATTENDU :
  ✗ 15 tests échouent (FAIL)
  ✓ 0 tests passent

  → Phase RED confirmée. Prêt pour l'implémentation.

SI certains tests passent sans code :
  → ANOMALIE. Investiguer pourquoi (test trivial, stub incorrect, etc.)
```

### Étape 5 : Implémenter (`/implement`)

```
Agent Dev :
    1. Lit les specs + architecture + tests
    2. Implémente itérativement

       Itération 1 : auth.types.ts (interfaces)
           → Run tests → 15 FAIL (normal, juste les types)

       Itération 2 : password.hasher.ts
           → Run tests → 12 FAIL, 3 PASS ✓

       Itération 3 : token.service.ts
           → Run tests → 10 FAIL, 5 PASS ✓

       Itération 4 : lockout.service.ts
           → Run tests → 7 FAIL, 8 PASS ✓

       Itération 5 : auth.service.ts
           → Run tests → 2 FAIL, 13 PASS ✓

       Itération 6 : correction des 2 derniers cas
           → Run tests → 0 FAIL, 15 PASS ✓

    3. IMPORTANT : à aucun moment le dev ne modifie les tests.
       Si un test semble incorrect, il le signale au QA.
```

### Étape 6 : Phase GREEN (`/qa-gate`)

```
Exécution : npm test

RÉSULTAT ATTENDU :
  ✓ 15 tests passent (PASS)
  ✗ 0 tests échouent

  Coverage :
    Statements : 92% (cible : 80%) ✓
    Branches   : 85% (cible : 75%) ✓
    Functions  : 100% (cible : 90%) ✓

  → Phase GREEN confirmée. Prêt pour le refactoring.
```

### Étape 7 : Refactorer (`/refactor`)

```
Agent Dev (supervisé par QA) :
    1. Identifie les améliorations possibles
       - Extraction de constantes
       - Simplification de conditions
       - DRY sur les patterns répétés

    2. Refactore avec vérification continue
       → Chaque modification est suivie d'un run de tests
       → Si un test casse : rollback immédiat

    3. Résultat : code propre, tests toujours verts
```

### Étape 8 : Validation PO

```
Agent PO :
    1. Relit les critères d'acceptation
    2. Vérifie chaque CA contre les résultats de test
    3. Peut demander une démonstration (exécution manuelle)

    Résultat :
    ☑ CA1: Tests register_valid + reject_short_password PASS ✓
    ☑ CA2: Test reject_duplicate_email PASS ✓
    ☑ CA3: Test login_correct_credentials PASS ✓
    ☑ CA4: Test reject_wrong_password PASS ✓
    ☑ CA5: Tests lockout_after_5 + unlock_after_15min PASS ✓
    ☑ CA6: Test hash_with_bcrypt PASS ✓
    ☑ CA7: Test return_jwt PASS ✓

    → STORY VALIDÉE
```

---

## 4. Traçabilité (`/trace-requirements`)

DevBunker maintient une matrice de traçabilité complète :

```
Spec → Story → Critère d'acceptation → Test → Code

Exemple :
  SPEC: "Authentification sécurisée"
    └── STORY: auth-email-password
          ├── CA1: inscription email valide
          │     ├── TEST: register_valid_email (tests/unit/auth.service.test.ts:12)
          │     └── CODE: AuthService.register() (src/auth/auth.service.ts:25)
          ├── CA5: verrouillage après 5 échecs
          │     ├── TEST: lockout_after_5 (tests/unit/auth.service.test.ts:67)
          │     └── CODE: LockoutService.check() (src/auth/lockout.service.ts:18)
          └── ...
```

Cette traçabilité permet de :
- Vérifier qu'aucune spec n'est oubliée
- Identifier le code impacté par un changement de spec
- Générer des rapports de couverture fonctionnelle (pas seulement code)

---

## 5. Structure de dossiers type d'un projet DevBunker

```
mon-projet/
├── docs/
│   ├── specs/                  Spécifications fonctionnelles
│   ├── stories/                User stories + critères d'acceptation
│   ├── architecture/           Documents d'architecture
│   ├── test-plans/             Plans de test
│   ├── sprints/                Planification
│   └── traceability.md         Matrice de traçabilité
│
├── tests/
│   ├── unit/                   Tests unitaires (générés par QA)
│   ├── integration/            Tests d'intégration (générés par QA)
│   └── acceptance/             Tests d'acceptation (générés par QA)
│
├── src/                        Code source (écrit par Dev)
│
├── devbunker.json              Configuration DevBunker
└── .devbunker/
    ├── logs/                   Logs des guards
    └── state/                  État des sessions
```
