# DevBunker

**L'agent de développement IA air-gapped avec méthodologie TDD-first intégrée.**

DevBunker est un fork d'[OpenCode](https://github.com/anomalyco/opencode) qui garantit
que toute l'inférence IA reste locale (Ollama, LM Studio, vLLM) tout en intégrant
la méthodologie BMAD et un workflow TDD-first où les tests sont générés depuis les
spécifications avant l'implémentation.

## Principes

- **LLM local uniquement** : aucune donnée de code n'est envoyée à un service cloud d'IA
- **TDD-first from specs** : les tests sont écrits avant le code, par un agent qui ne voit jamais l'implémentation
- **Sécurité intégrée** : guards sur le filesystem, le shell et git pour prévenir les fuites accidentelles
- **BMAD complet** : agents spécialisés (analyst, architect, qa, dev, po) pour un workflow structuré

## Documentation

- [Spécifications techniques](docs/SPECS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Modèle de sécurité](docs/SECURITY.md)
- [Méthodologie BMAD + TDD](docs/BMAD-TDD.md)
- [Roadmap](docs/ROADMAP.md)

## Statut

Projet en phase de conception. Le développement commencera par le fork d'OpenCode
et l'implémentation du provider lock (Phase 0).

## Licence

MIT - Voir [LICENSE](LICENSE)

## Crédits

Basé sur [OpenCode](https://github.com/anomalyco/opencode) par [Anomaly](https://github.com/anomalyco).
