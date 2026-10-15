# Winterfreeze 2027

Site statique pour le voyage Winterfreeze, du 28 au 31 janvier 2027 au chalet Le Simonet. Le contenu du voyage vient de `WinterFreeze 2027.xlsx`.

- `data.js` : détails du voyage (horaire, repas, épicerie, finances, D&D)
- `equip-data.js` : équipement par personne et WTF Box (générés depuis le chiffrier)
- Les listes et cases cochées sont partagées entre les navigateurs via Supabase.
- Le plan des repas est partagé en direct; les participants peuvent ajouter ou modifier le menu, les responsables et les notes de chaque créneau.
- Les dépenses sont partagées en direct dans Supabase et limitées aux comptes des huit participants.
- La galerie permet aux participants connectés de téléverser des photos privées et des légendes.
- Un compte participant Supabase est requis pour utiliser toutes les sections; la même session donne accès aux finances.
- Les inscriptions publiques Supabase doivent rester désactivées; les comptes sont créés par l’organisateur.
- Les participants peuvent modifier les listes partagées d’épicerie, d’équipement, de WTF Box et de ménage; les changements et cases cochées se synchronisent.

## Configurer les données partagées et les finances privées

1. Créez un **nouveau projet Supabase** réservé à Winterfreeze. Dans les paramètres d’authentification des fournisseurs de connexion par courriel, désactivez **Allow new users to sign up**. Ne réutilisez pas le projet d’un autre site.
2. Dans l’éditeur SQL du projet, exécutez [`supabase-schema.sql`](./supabase-schema.sql). Cela crée les tables des dépenses, du plan des repas, des listes partagées et des photos, configure le bucket privé de la galerie, active RLS, autorise l’accès aux seuls comptes connectés et active les mises à jour en direct. Réexécutez ce script pour activer ces fonctionnalités sur un projet déjà configuré; il conserve les dépenses, repas, listes et photos déjà enregistrés. La clé `service_role` n’est jamais utilisée par le site.
3. Dans **Project Settings → API**, copiez l’URL du projet et la clé **publishable** (ou l’ancienne clé `anon`) dans `supabase-config.js` :

   ```js
   window.WTF_SUPABASE = {
     url: 'https://VOTRE-PROJET.supabase.co',
     anonKey: 'VOTRE-CLE-PUBLISHABLE',
   };
   ```

   Cette clé publique sera visible dans le navigateur et dans le dépôt. C’est attendu : la sécurité dépend des politiques RLS, pas du secret de la clé. **N’inscrivez jamais une clé `service_role` ou secrète ici.**
4. Dans **Authentication → Users**, créez un compte (courriel et mot de passe) pour chacun des huit participants. Désactivez les inscriptions publiques et ne distribuez les identifiants qu’aux participants.
5. Dans **Authentication → URL Configuration**, réglez **Site URL** sur `https://wtf.jopism.com`.
6. Committez et poussez `supabase-config.js` avec les changements du site. Les comptes peuvent ensuite se connecter au site.

Au premier accès connecté, le site copie les listes par défaut du code vers Supabase une seule fois et importe les cases cochées locales de ce premier navigateur. Les anciennes cases des autres navigateurs n’étaient pas synchronisées et ne peuvent pas être fusionnées automatiquement. Le plan de repas par défaut est ajouté une seule fois par créneau et les modifications partagées ne sont pas écrasées; les participants peuvent ajouter ou modifier les menus, responsables et notes dans l’onglet **Repas**. Les participants peuvent aussi ajouter, modifier (incluant le statut Good/Maybe de la WTF Box) ou supprimer des articles avec **Modifier la liste**; les cases cochées et le contenu se synchronisent entre leurs appareils, sans modification du code ni nouveau déploiement. Chaque dépense indique le payeur; seul le participant qui l’a créée peut la supprimer. Les participants peuvent ajouter des photos JPG, PNG, WebP ou GIF jusqu’à 10 Mo avec une légende facultative; seuls les comptes connectés peuvent voir les photos et seul le compte ayant téléversé une photo peut la supprimer. Les fichiers sont conservés dans un bucket Supabase privé et ne sont pas enregistrés dans le dépôt GitHub.

L’écran de connexion empêche l’utilisation normale des sections sans session, comme sur le site Le Gouin. GitHub Pages sert toutefois un site statique public : un visiteur déterminé peut télécharger les fichiers et lire les détails inclus dans le code. La connexion seule ne rend donc pas les fichiers du site confidentiels. Les autorisations des données partagées doivent être appliquées dans Supabase avec RLS.

## Déploiement sur `wtf.jopism.com`

1. Poussez ce dossier dans un dépôt GitHub (branche `main`).
2. **Settings → Pages** : source « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. Custom domain : `wtf.jopism.com` (le fichier `CNAME` est déjà inclus), puis cochez « Enforce HTTPS ».
4. Chez le fournisseur DNS de `jopism.com` : CNAME `wtf` vers `<votre-compte>.github.io`.

Le dépôt GitHub et les fichiers statiques du site sont publics, même si l’interface demande une connexion. N’incluez pas de secrets dans les fichiers du site. Les dépenses, repas, photos et listes ne sont accessibles qu’aux comptes autorisés par Supabase RLS.
