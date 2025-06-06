# Guide du développeur - Système d'apprentissage

## Architecture du système d'apprentissage

### Composants principaux

1. **Service de progression (LearningProgressService)**
   - Gestion de l'expérience et des niveaux
   - Suivi des exercices complétés
   - Gestion du vocabulaire personnalisé
   - Suivi de la progression des vidéos

2. **Contrôleur d'apprentissage (LearningProgressController)**
   - API REST pour toutes les fonctionnalités d'apprentissage
   - Points de terminaison pour le suivi de la progression
   - Gestion des requêtes liées aux exercices
   - Endpoints pour la révision du vocabulaire

### Schéma de base de données

```sql
-- Progression globale de l'utilisateur
CREATE TABLE "user_progress" (
    "id" serial PRIMARY KEY,
    "user_id" text NOT NULL,
    "level" integer DEFAULT 1,
    "total_xp" integer DEFAULT 0,
    "current_streak" integer DEFAULT 0,
    "last_activity" timestamp,
    -- ... autres champs
);

-- Suivi des exercices
CREATE TABLE "exercise_completions" (
    "id" serial PRIMARY KEY,
    "user_id" text NOT NULL,
    "exercise_id" integer NOT NULL,
    "score" integer NOT NULL,
    "is_correct" boolean DEFAULT false,
    -- ... autres champs
);

-- Vocabulaire personnalisé
CREATE TABLE "user_vocabulary" (
    "id" serial PRIMARY KEY,
    "user_id" text NOT NULL,
    "word_id" integer NOT NULL,
    "mastery_level" integer DEFAULT 0,
    "next_review" timestamp,
    -- ... autres champs
);

-- Progression des vidéos
CREATE TABLE "video_progress" (
    "id" serial PRIMARY KEY,
    "user_id" text NOT NULL,
    "video_id" integer NOT NULL,
    "watched_seconds" integer DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    -- ... autres champs
);
```

## Points d'extension

### 1. Ajout de nouveaux types d'exercices

Pour ajouter un nouveau type d'exercice :
1. Définir le type dans `exerciseTypeEnum`
2. Créer les schémas de données nécessaires
3. Ajouter les méthodes correspondantes dans `LearningProgressService`
4. Créer les endpoints dans `LearningProgressController`

### 2. Personnalisation du système d'XP

Le calcul des XP peut être modifié dans `LearningProgressService` :
```typescript
async updateUserXP(userId: string, xpToAdd: number) {
  // Personnaliser la logique de calcul des XP
  // Modifier les seuils de niveau
  // Ajouter des bonus
}
```

### 3. Modification du système de révision

Les intervalles de révision peuvent être ajustés dans la méthode :
```typescript
private calculateNextReview(masteryLevel: number): Date {
  // Personnaliser les intervalles de révision
  // Ajouter des facteurs d'ajustement
  // Implémenter des algorithmes plus sophistiqués
}
```

### 4. Ajout de métriques d'apprentissage

Pour ajouter de nouvelles métriques :
1. Modifier le schéma de la table appropriée
2. Ajouter les méthodes de calcul dans le service
3. Créer les endpoints pour récupérer les métriques
4. Mettre à jour les types TypeScript correspondants

## Bonnes pratiques

### Gestion de la progression

- Toujours utiliser les transactions pour les mises à jour multiples
- Valider les données avant de les sauvegarder
- Maintenir la cohérence des niveaux de maîtrise
- Gérer les cas d'erreur appropriément

### Performance

- Indexer les champs fréquemment utilisés
- Utiliser des requêtes optimisées pour les grands volumes de données
- Mettre en cache les données fréquemment accédées
- Paginer les résultats des requêtes importantes

### Sécurité

- Valider l'identité de l'utilisateur pour chaque requête
- Vérifier les autorisations avant les mises à jour
- Sanitiser toutes les entrées utilisateur
- Protéger contre les attaques par injection

## Tests

### Tests unitaires
```typescript
describe('LearningProgressService', () => {
  describe('updateUserXP', () => {
    it('should increase user level when XP threshold is reached')
    it('should maintain streak when learning daily')
    it('should reset streak when missing a day')
  })

  describe('vocabulary mastery', () => {
    it('should calculate correct review intervals')
    it('should update mastery level correctly')
  })
})
```

### Tests d'intégration
```typescript
describe('Learning Progress API', () => {
  describe('POST /exercise-completion', () => {
    it('should save exercise results')
    it('should award correct XP')
    it('should update user progress')
  })
})
```
