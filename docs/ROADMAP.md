# DevBunker - Roadmap

## Phase 0 : Fondation

### P0.1 — Fork et renommage
- [ ] Forker `anomalyco/opencode` v1.2.21
- [ ] Renommer le package : opencode → devbunker
- [ ] Mettre à jour le branding (nom, description, liens)
- [ ] Vérifier que le build fonctionne tel quel
- [ ] Configurer le repo GitHub (issues, labels, CI basique)

### P0.2 — Provider Lock
- [ ] Identifier le fichier `BUNDLED_PROVIDERS` dans le source
- [ ] Supprimer tous les providers cloud
- [ ] Ne conserver que le provider `openai-compatible`
- [ ] Ajouter les presets locaux (Ollama, LM Studio, vLLM, llama.cpp, LocalAI)
- [ ] Tester la connexion avec Ollama
- [ ] S'assurer qu'aucun appel réseau vers un provider cloud n'est possible

### P0.3 — Détection RAM et filtrage modèles
- [ ] Implémenter `ram/detector.ts` (Windows, macOS, Linux)
- [ ] Implémenter la détection VRAM GPU (optionnel, best-effort)
- [ ] Créer la table de correspondance modèle → RAM requise
- [ ] Implémenter `ram/model-filter.ts`
- [ ] Modifier l'UI pour griser les modèles trop gourmands
- [ ] Permettre le forçage avec avertissement
- [ ] Tests unitaires

---

## Phase 1 : Sécurité

### P1.1 — Filesystem Scope
- [ ] Implémenter `guard/filesystem-scope.ts`
- [ ] Résolution de chemins absolus
- [ ] Résolution et vérification des symlinks
- [ ] Intégrer dans ReadTool, WriteTool, EditTool, GlobTool, GrepTool
- [ ] Liste de fichiers sensibles (avertissement/blocage)
- [ ] Tests unitaires (chemins normaux, traversal, symlinks)

### P1.2 — Shell Guard
- [ ] Implémenter `guard/shell-guard.ts`
- [ ] Parser de commandes (extraction binaire + arguments)
- [ ] Whitelist, confirmlist, blocklist
- [ ] Détection de contournement (pipes vers shell, eval, etc.)
- [ ] Vérification du working directory
- [ ] Intégrer dans BashTool
- [ ] Tests unitaires

### P1.3 — Git Guard
- [ ] Implémenter `guard/git-guard.ts`
- [ ] Configuration de la remote whitelist
- [ ] Interception des opérations distantes
- [ ] Blocage de --force
- [ ] Intégrer dans BashTool (commandes git)
- [ ] Tests unitaires

### P1.4 — Secret Scan
- [ ] Implémenter `guard/secret-scan.ts`
- [ ] Patterns de détection (AWS, GitHub, Stripe, JWT, etc.)
- [ ] Scan du diff avant push
- [ ] Scan des fichiers avant commit (optionnel)
- [ ] Tests unitaires avec échantillons

### P1.5 — Logging
- [ ] Système de logging des guards
- [ ] Stockage dans `.devbunker/logs/`
- [ ] Format structuré (JSON ou texte lisible)
- [ ] Commande de consultation des logs

---

## Phase 2 : BMAD + TDD

### P2.1 — Agents BMAD
- [ ] Définir la structure d'un agent DevBunker (extension du système OpenCode)
- [ ] Implémenter l'agent Analyst (system prompt, permissions fichiers)
- [ ] Implémenter l'agent Architect
- [ ] Implémenter l'agent QA (avec restriction d'accès à src/)
- [ ] Implémenter l'agent Dev (avec restriction d'écriture sur tests/)
- [ ] Implémenter l'agent PO
- [ ] Implémenter l'agent PM
- [ ] Implémenter l'agent SM
- [ ] Système de changement d'agent dans la TUI

### P2.2 — Workflow TDD-First
- [ ] Implémenter `bmad/tdd/spec-to-test.ts`
- [ ] Implémenter `bmad/tdd/test-runner.ts` (orchestration red/green/refactor)
- [ ] Implémenter `bmad/tdd/coverage.ts` (parsing des rapports de couverture)
- [ ] Implémenter la vérification de phase (RED = 100% fail, GREEN = 100% pass)
- [ ] Tests d'intégration du workflow complet

### P2.3 — Tasks (slash commands)
- [ ] `/create-story` — Créer une user story
- [ ] `/review-story` — Revue qualité d'une story
- [ ] `/generate-tests` — Générer les tests depuis les specs
- [ ] `/implement` — Implémenter pour faire passer les tests
- [ ] `/qa-gate` — Vérifier l'état des tests
- [ ] `/refactor` — Refactorer sans casser les tests
- [ ] `/create-doc` — Générer la documentation
- [ ] `/validate-next-story` — Valider et passer à la suivante
- [ ] `/trace-requirements` — Matrice de traçabilité

### P2.4 — Templates
- [ ] Template de spécification
- [ ] Template de user story
- [ ] Template de plan de test
- [ ] Template d'architecture
- [ ] Template de rapport de sprint

---

## Phase 3 : Documentation et distribution

### P3.1 — Documentation
- [ ] README.md (installation, quickstart, principes)
- [ ] Guide de configuration (devbunker.json)
- [ ] Guide des agents BMAD
- [ ] Guide du workflow TDD-first
- [ ] Guide de sécurité (guards, recommandations)
- [ ] FAQ

### P3.2 — CI/CD
- [ ] GitHub Actions : build sur PR
- [ ] GitHub Actions : tests unitaires
- [ ] GitHub Actions : linting
- [ ] GitHub Actions : release automatique (tags)

### P3.3 — Packaging
- [ ] Publication npm (@devbunker/cli)
- [ ] Script d'installation curl
- [ ] Binaires standalone (pkg ou équivalent Bun)
- [ ] Image Docker (optionnel)

---

## Phase 4 : Application Desktop (optionnel)

### P4.1 — Tauri
- [ ] Adapter l'app Tauri d'OpenCode
- [ ] Branding DevBunker
- [ ] Installeurs Windows, macOS, Linux
- [ ] Auto-update
