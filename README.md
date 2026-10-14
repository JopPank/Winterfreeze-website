# Winterfreeze 2027

Site statique (HTML/CSS/JS, sans build) pour le voyage Winterfreeze, du 28 au 31 janvier 2027 au chalet Le Simonet. Les données viennent de `WinterFreeze 2027.xlsx`.

- `data.js` : détails du voyage (horaire, repas, épicerie, finances, D&D)
- `equip-data.js` : équipement par personne et WTF Box (générés depuis le chiffrier)
- Les cases cochées sont gardées dans le navigateur (localStorage), par appareil.

## Déploiement sur `wtf.jopism.com`

1. Poussez ce dossier dans un dépôt GitHub (branche `main`).
2. **Settings → Pages** : source « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. Custom domain : `wtf.jopism.com` (le fichier `CNAME` est déjà inclus), puis cochez « Enforce HTTPS ».
4. Chez le fournisseur DNS de `jopism.com` : CNAME `wtf` vers `<votre-compte>.github.io`.

Le site est public. Le mot de passe WiFi et les détails financiers ne sont pas inclus dans les données publiques.
