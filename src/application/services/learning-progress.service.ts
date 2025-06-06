import { eq, isNull, lte } from 'drizzle-orm'
import { db } from '../../infrastructure/database/db'
import { exerciseCompletions, userProgress, userVocabulary, videoProgress } from '../../infrastructure/database/schema'

export class LearningProgressService {
  // Progression globale
  async getUserProgress(userId: string) {
    const progress = await db.query.userProgress.findFirst({
      where: eq(userProgress.userId, userId)
    })
    return progress
  }

  async updateUserXP(userId: string, xpToAdd: number) {
    const currentProgress = await this.getUserProgress(userId)
    if (!currentProgress) {
      // Créer une nouvelle entrée de progression
      return await db.insert(userProgress).values({
        userId,
        totalXp: xpToAdd,
        level: Math.floor(xpToAdd / 1000) + 1 // Simple calcul de niveau : chaque 1000 XP = 1 niveau
      })
    }

    // Mettre à jour la progression existante
    return await db
      .update(userProgress)
      .set({
        totalXp: currentProgress.totalXp + xpToAdd,
        level: Math.floor((currentProgress.totalXp + xpToAdd) / 1000) + 1,
        updatedAt: new Date()
      })
      .where(eq(userProgress.userId, userId))
  }

  // Exercices
  async saveExerciseCompletion(
    userId: string,
    exerciseId: number,
    score: number,
    isCorrect: boolean,
    timeTaken?: number
  ) {
    return await db.insert(exerciseCompletions).values({
      userId,
      exerciseId,
      score,
      isCorrect,
      timeTaken
    })
  }

  async getExerciseHistory(userId: string) {
    return await db.query.exerciseCompletions.findMany({
      where: eq(exerciseCompletions.userId, userId),
      orderBy: (exerciseCompletions, { desc }) => [desc(exerciseCompletions.completedAt)]
    })
  }

  // Vocabulaire
  async updateVocabularyMastery(userId: string, wordId: number, masteryLevel: number) {
    const existingEntry = await db.query.userVocabulary.findFirst({
      where: eq(userVocabulary.wordId, wordId) && eq(userVocabulary.userId, userId)
    })

    if (!existingEntry) {
      return await db.insert(userVocabulary).values({
        userId,
        wordId,
        masteryLevel,
        nextReview: this.calculateNextReview(masteryLevel),
        lastReviewed: new Date()
      })
    }

    return await db
      .update(userVocabulary)
      .set({
        masteryLevel,
        nextReview: this.calculateNextReview(masteryLevel),
        lastReviewed: new Date(),
        updatedAt: new Date()
      })
      .where(eq(userVocabulary.id, existingEntry.id))
  }

  async getWordsForReview(userId: string) {
    return await db.query.userVocabulary.findMany({
      where:
        eq(userVocabulary.userId, userId) &&
        (lte(userVocabulary.nextReview, new Date()) || isNull(userVocabulary.nextReview))
    })
  }

  // Progression vidéo
  async updateVideoProgress(userId: string, videoId: number, watchedSeconds: number) {
    const existingProgress = await db.query.videoProgress.findFirst({
      where: eq(videoProgress.videoId, videoId) && eq(videoProgress.userId, userId)
    })

    if (!existingProgress) {
      return await db.insert(videoProgress).values({
        userId,
        videoId,
        watchedSeconds,
        isCompleted: false
      })
    }

    return await db
      .update(videoProgress)
      .set({
        watchedSeconds,
        isCompleted: false,
        lastWatched: new Date(),
        updatedAt: new Date()
      })
      .where(eq(videoProgress.id, existingProgress.id))
  }

  async markVideoCompleted(userId: string, videoId: number) {
    const existingProgress = await db.query.videoProgress.findFirst({
      where: eq(videoProgress.videoId, videoId) && eq(videoProgress.userId, userId)
    })

    if (!existingProgress) {
      return await db.insert(videoProgress).values({
        userId,
        videoId,
        isCompleted: true
      })
    }

    return await db
      .update(videoProgress)
      .set({
        isCompleted: true,
        lastWatched: new Date(),
        updatedAt: new Date()
      })
      .where(eq(videoProgress.id, existingProgress.id))
  }

  private calculateNextReview(masteryLevel: number): Date {
    const now = new Date()
    switch (masteryLevel) {
      case 1:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000) // +1 jour
      case 2:
        return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) // +3 jours
      case 3:
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // +1 semaine
      case 4:
        return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) // +2 semaines
      case 5:
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // +1 mois
      default:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000) // +1 jour par défaut
    }
  }
}
