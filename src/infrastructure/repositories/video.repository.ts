import { promises as fs } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { VideoModel, type Video } from '@/domain/models/video.model'
import { ExerciseDataSchema, PronunciationSchema } from '@/domain/types/exercise.types'
import type { VideoRepositoryInterface, VideoSegment } from '@/domain/repositories/video.repository.interface'
import { db } from '../database/db'
import {
  exerciseOptions,
  exerciseQuestions,
  exercises,
  pronunciations,
  wordEntries
} from '../database/schema/exercise.schema'
import { audioSegments, processingLogs, videos, wordSegments } from '../database/schema/video.schema'
import { BaseRepository } from './base.repository'
import type { PgTransaction } from 'drizzle-orm/pg-core'

interface ExerciseOption {
  id: number
  text: string
  isCorrect: boolean
}

interface ExerciseQuestion {
  id: number
  direction: 'de_to_fr' | 'fr_to_de'
  questionDe: string
  questionFr: string
  wordToTranslate: string
  correctAnswer: string
  options: ExerciseOption[]
}

interface Exercise {
  id: number
  type: string
  level: string
  questions: ExerciseQuestion[]
}

export class VideoRepository extends BaseRepository<typeof videos> implements VideoRepositoryInterface {
  constructor() {
    super(videos)
  }

  private validateTime(time: unknown): number {
    const num = Number(time)
    return Number.isNaN(num) ? 0 : Math.floor(num * 1000)
  }

  private validateScore(score: unknown): number {
    const num = Number(score)
    return Number.isNaN(num) ? 0 : Math.floor(num * 1000)
  }

  async insertVideo(videoData: Omit<Video, 'id'>): Promise<number> {
    const [result] = await db
      .insert(videos)
      .values({
        title: videoData.title,
        originalFilename: videoData.originalFilename,
        filePath: videoData.filePath,
        fileSize: videoData.fileSize,
        language: videoData.language || 'de',
        transcriptionStatus: 'pending',
        tempInfoFile: videoData.tempInfoFile
      })
      .returning({ id: videos.id })

    return result.id
  }

  async updateVideoStatus(
    videoId: number,
    status: Video['transcriptionStatus'],
    data?: {
      jobId?: string
      errorMessage?: string
      transcriptionFile?: string
    }
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      transcriptionStatus: status,
      updatedAt: new Date()
    }

    if (data?.jobId) {
      updateData.queueJobId = data.jobId
    }
    if (data?.errorMessage) {
      updateData.errorMessage = data.errorMessage
    }
    if (data?.transcriptionFile) {
      updateData.transcriptionFile = data.transcriptionFile
    }
    if (status === 'completed') {
      updateData.processedAt = new Date()
    }

    await db.update(videos).set(updateData).where(eq(videos.id, videoId))
  }

  async logProcessingStep(
    videoId: number,
    step: string,
    status: 'started' | 'completed' | 'failed',
    message: string | null = null
  ): Promise<void> {
    await db.insert(processingLogs).values({
      videoId,
      step,
      status,
      message: message || undefined
    })
  }

  async getVideoById(id: number): Promise<VideoModel | null> {
    const [result] = await db.select().from(videos).where(eq(videos.id, id)).limit(1)

    return result ? new VideoModel(this.mapVideoFromDb(result)) : null
  }

  async getRecentVideos(limit: number = 20): Promise<VideoModel[]> {
    // 1. Récupérer les données brutes
    const results = await this.fetchRecentVideosData(limit)

    // 2. Regrouper par vidéo
    const videoMap = new Map()

    // 3. Traiter chaque ligne
    for (const row of results) {
      this.processVideoRow(row, videoMap)
    }

    // 4. Transformer en VideoModel
    return this.transformToVideoModels(videoMap)
  }

  private fetchRecentVideosData(limit: number) {
    return db
      .select({
        video: videos,
        segments: audioSegments,
        words: wordSegments,
        wordEntry: wordEntries,
        exercise: exercises,
        exerciseQuestion: exerciseQuestions,
        exerciseOption: exerciseOptions,
        pronunciation: pronunciations
      })
      .from(videos)
      .leftJoin(audioSegments, eq(videos.id, audioSegments.videoId))
      .leftJoin(wordSegments, eq(audioSegments.id, wordSegments.audioSegmentId))
      .leftJoin(wordEntries, eq(wordSegments.word, wordEntries.word))
      .leftJoin(exercises, eq(wordEntries.id, exercises.wordId))
      .leftJoin(exerciseQuestions, eq(exercises.id, exerciseQuestions.exerciseId))
      .leftJoin(exerciseOptions, eq(exerciseQuestions.id, exerciseQuestions.id))
      .leftJoin(pronunciations, eq(wordEntries.id, pronunciations.wordId))
      .orderBy(sql`${videos.createdAt} DESC`)
      .limit(limit)
  }

  private processVideoRow(row: any, videoMap: Map<number, any>) {
    // Initialiser la vidéo si nécessaire
    if (!videoMap.has(row.video.id)) {
      videoMap.set(row.video.id, {
        ...this.mapVideoFromDb(row.video),
        segments: [],
        vocabulary: new Map()
      })
    }

    const videoData = videoMap.get(row.video.id)

    // Traiter le segment audio
    if (row.segments) {
      this.processSegment(row.segments, videoData)
    }

    // Traiter le mot et ses données associées
    if (row.words) {
      this.processWord(row, videoData)
    }
  }

  private processSegment(segment: any, videoData: any) {
    if (!videoData.segments.some((s: { id: number }) => s.id === segment.id)) {
      videoData.segments.push({
        id: segment.id,
        startTime: segment.startTime / 1000,
        endTime: segment.endTime / 1000,
        text: segment.text,
        translation: segment.translation,
        language: segment.language,
        words: []
      })
    }
  }

  private processWord(row: any, videoData: any) {
    const { words: rowWords, wordEntry, exercise, exerciseQuestion, exerciseOption, pronunciation } = row

    // Ajouter au segment
    const segment = videoData.segments.find((s: { id: number }) => s.id === rowWords.audioSegmentId)
    if (segment && !segment.words.some((w: { word: string }) => w.word === rowWords.word)) {
      segment.words.push(this.createWordData(rowWords))
    }

    // Initialiser ou mettre à jour le vocabulaire
    if (!videoData.vocabulary.has(rowWords.word)) {
      videoData.vocabulary.set(rowWords.word, this.initializeVocabularyEntry(wordEntry))
    }

    const wordData = videoData.vocabulary.get(rowWords.word)
    this.updateWordData(wordData, rowWords, exercise, exerciseQuestion, exerciseOption, pronunciation)
  }

  private createWordData(word: any) {
    return {
      word: word.word,
      startTime: word.startTime / 1000,
      endTime: word.endTime / 1000,
      confidenceScore: word.confidenceScore / 1000
    }
  }

  private initializeVocabularyEntry(wordEntry: any) {
    return {
      occurrences: [],
      confidenceScoreAvg: 0,
      metadata: wordEntry?.metadata ?? null,
      translations: wordEntry?.translations ?? [],
      examples: wordEntry?.examples ?? [],
      level: wordEntry?.level ?? 'intermediate',
      exercises: [],
      pronunciations: []
    }
  }

  private updateWordData(wordData: any, words: any, exercise: any, question: any, option: any, pronunciation: any) {
    // Ajouter l'occurrence
    wordData.occurrences.push({
      segmentId: words.audioSegmentId,
      startTime: words.startTime / 1000,
      endTime: words.endTime / 1000,
      confidenceScore: words.confidenceScore / 1000
    })

    // Ajouter l'exercice si nécessaire
    if (exercise?.id && !wordData.exercises.some((ex: { id: number }) => ex.id === exercise.id)) {
      const newExercise = this.createExercise(exercise, question, option)
      if (newExercise) {
        wordData.exercises.push(newExercise)
      }
    }

    // Ajouter la prononciation si nécessaire
    if (pronunciation?.id && !wordData.pronunciations.some((p: { id: number }) => p.id === pronunciation.id)) {
      wordData.pronunciations.push({
        id: pronunciation.id,
        filePath: pronunciation.filePath,
        type: pronunciation.type,
        language: pronunciation.language
      })
    }
  }

  private createExercise(exercise: any, question: any, option: any): Exercise | null {
    if (!exercise) return null

    const newExercise: Exercise = {
      id: exercise.id,
      type: exercise.type,
      level: exercise.level,
      questions: []
    }

    if (question?.id) {
      const newQuestion: ExerciseQuestion = {
        id: question.id,
        direction: question.direction as 'de_to_fr' | 'fr_to_de',
        questionDe: question.questionDe,
        questionFr: question.questionFr,
        wordToTranslate: question.wordToTranslate,
        correctAnswer: question.correctAnswer,
        options: []
      }

      if (option?.id) {
        newQuestion.options.push({
          id: option.id,
          text: option.optionText,
          isCorrect: option.isCorrect
        })
      }

      newExercise.questions.push(newQuestion)
    }

    return newExercise
  }

  private transformToVideoModels(videoMap: Map<number, any>): VideoModel[] {
    return Array.from(videoMap.values()).map((videoData) => {
      const vocabulary = Array.from(videoData.vocabulary.entries() as [string, any][])
        .map(([word, data]) => {
          // Transform translations from array to object
          const translations =
            data.translations && Array.isArray(data.translations)
              ? data.translations.reduce((obj: Record<string, string>, trans: any) => {
                  if (trans.language && trans.text) {
                    obj[trans.language] = trans.text
                  }
                  return obj
                }, {})
              : {}

          // Transform exercise to match ExerciseDataSchema
          const exercise = data.exercises?.[0]
          const deToFrQuestion = exercise?.questions.find((q: { direction: string }) => q.direction === 'de_to_fr')
          const frToDeQuestion = exercise?.questions.find((q: { direction: string }) => q.direction === 'fr_to_de')

          // If we don't have both questions, return a default exercise structure
          if (!exercise || !deToFrQuestion || !frToDeQuestion) {
            return {
              word,
              occurrences: data.occurrences,
              confidenceScoreAvg: this.calculateConfidenceScore(data.occurrences),
              metadata: data.metadata,
              translations,
              examples: Array.isArray(data.examples) ? data.examples : [],
              level: data.level,
              exercises: {
                type: 'multiple_choice_pair' as const,
                level: 'intermediate',
                de_to_fr: {
                  question: { de: '', fr: '' },
                  word_to_translate: '',
                  correct_answer: '',
                  options: []
                },
                fr_to_de: {
                  question: { de: '', fr: '' },
                  word_to_translate: '',
                  correct_answer: '',
                  options: []
                }
              },
              pronunciations: (data.pronunciations || []).map((p: any) => ({
                file: p.filePath,
                type: p.type,
                language: p.language
              }))
            }
          }

          const transformedExercise = {
            type: 'multiple_choice_pair' as const,
            level: exercise.level as 'beginner' | 'intermediate' | 'advanced',
            de_to_fr: {
              question: {
                de: deToFrQuestion.questionDe,
                fr: deToFrQuestion.questionFr
              },
              word_to_translate: deToFrQuestion.wordToTranslate,
              correct_answer: deToFrQuestion.correctAnswer,
              options: deToFrQuestion.options.map((opt: { text: string }) => opt.text)
            },
            fr_to_de: {
              question: {
                de: frToDeQuestion.questionDe,
                fr: frToDeQuestion.questionFr
              },
              word_to_translate: frToDeQuestion.wordToTranslate,
              correct_answer: frToDeQuestion.correctAnswer,
              options: frToDeQuestion.options.map((opt: { text: string }) => opt.text)
            }
          }

          return {
            word,
            occurrences: data.occurrences,
            confidenceScoreAvg: this.calculateConfidenceScore(data.occurrences),
            metadata: data.metadata,
            translations,
            examples: Array.isArray(data.examples) ? data.examples : [],
            level: data.level,
            exercises: transformedExercise,
            pronunciations: (data.pronunciations || []).map((p: any) => ({
              file: p.filePath,
              type: p.type,
              language: p.language
            }))
          }
        })
        .sort((a, b) => b.confidenceScoreAvg - a.confidenceScoreAvg)

      return new VideoModel({
        ...videoData,
        vocabulary
      })
    })
  }

  private calculateConfidenceScore(occurrences: { confidenceScore: number }[]): number {
    if (!occurrences.length) return 0
    return occurrences.reduce((acc, curr) => acc + curr.confidenceScore, 0) / occurrences.length
  }

  async deleteVideo(id: number): Promise<void> {
    await db.delete(videos).where(eq(videos.id, id))
  }

  async insertAudioSegments(segments: VideoSegment[], videoId: number, language: string): Promise<number[]> {
    const audioSegmentIds: number[] = []

    await db.transaction(async (tx) => {
      for (const segment of segments) {
        const [audioSegment] = await tx
          .insert(audioSegments)
          .values({
            videoId,
            startTime: this.validateTime(segment.startTime),
            endTime: this.validateTime(segment.endTime),
            text: segment.text || '',
            language,
            translation: segment.translation
          })
          .returning({ id: audioSegments.id })

        const audioSegmentId = audioSegment.id
        audioSegmentIds.push(audioSegmentId)

        if (segment.words && segment.words.length > 0) {
          const wordValues = segment.words.map((word, index) => ({
            audioSegmentId,
            word: word.word || '',
            startTime: this.validateTime(word.startTime),
            endTime: this.validateTime(word.endTime),
            confidenceScore: this.validateScore(word.confidenceScore),
            positionInSegment: index + 1
          }))

          await tx.insert(wordSegments).values(wordValues)
        }
      }
    })

    return audioSegmentIds
  }

  async loadTranscriptionData(
    videoId: number,
    transcriptionFile: string
  ): Promise<{
    segments: number
    vocabulary: number
    language: string
  }> {
    try {
      console.info(`📖 [Video ${videoId}] Lecture du fichier de transcription...`)
      const fileContent = await fs.readFile(transcriptionFile, 'utf8')
      const jsonData = JSON.parse(fileContent)
      console.info(`✅ [Video ${videoId}] Fichier JSON parsé avec succès`)

      let segmentsInserted = 0
      let vocabularyInserted = 0

      console.info(`📊 [Video ${videoId}] Analyse du contenu...`)

      await db.transaction(async (tx) => {
        // Insertion des segments audio
        if (Array.isArray(jsonData.segments)) {
          console.info(`🔄 [Video ${videoId}] Importation de ${jsonData.segments.length} segments audio...`)
          await this.insertAudioSegments(jsonData.segments, videoId, jsonData.language || 'de')
          segmentsInserted = jsonData.segments.length
          console.info(`✅ [Video ${videoId}] Segments audio importés avec succès`)
        }

        // Traitement du vocabulaire et des exercices
        if (Array.isArray(jsonData.vocabulary)) {
          console.info(`🔤 [Video ${videoId}] Traitement du vocabulaire (${jsonData.vocabulary.length} mots)...`)

          for (const word of jsonData.vocabulary) {
            // Insérer le mot dans la table wordEntries
            const [wordEntry] = await tx
              .insert(wordEntries)
              .values({
                word: word.word,
                language: word.metadata?.source_language || 'de',
                translations: word.translations,
                examples: word.examples,
                level: word.level || 'intermediate',
                metadata: word.metadata
              })
              .returning({ id: wordEntries.id })

            // Traitement des exercices
            if (word.exercises) {
              console.info(`📝 [Video ${videoId}] Traitement des exercices pour le mot ${word.word}...`)
              await this.insertExercisesTx(tx, word.exercises, wordEntry.id)
            }

            // Traitement des prononciations
            if (Array.isArray(word.pronunciations)) {
              console.info(`🔊 [Video ${videoId}] Ajout des prononciations pour le mot ${word.word}...`)
              const validatedPronunciations = word.pronunciations.map((p: unknown) => PronunciationSchema.parse(p))
              const pronunciationValues = validatedPronunciations.map((p: { file: any; type: any; language: any }) => ({
                wordId: wordEntry.id,
                filePath: p.file,
                type: p.type,
                language: p.language
              }))
              await tx.insert(pronunciations).values(pronunciationValues)
            }
          }

          vocabularyInserted = jsonData.vocabulary.length
          console.info(`✅ [Video ${videoId}] Vocabulaire traité avec succès`)
        }
      })

      const result = {
        segments: segmentsInserted,
        vocabulary: vocabularyInserted,
        language: jsonData.language || 'de'
      }

      console.info(`📊 [Video ${videoId}] Résumé de l'importation:
        - Segments audio: ${result.segments}
        - Mots de vocabulaire: ${result.vocabulary}
        - Langue: ${result.language}`)

      return result
    } catch (error) {
      throw new TypeError(`Erreur lors du chargement de la transcription: ${(error as Error).message}`)
    }
  }

  private async insertExercisesTx(
    tx: PgTransaction<any, any, any>,
    exercisesData: unknown,
    wordId: number
  ): Promise<void> {
    try {
      const result = ExerciseDataSchema.safeParse(exercisesData)
      if (!result.success) {
        throw new TypeError(`Données d'exercice invalides: ${result.error.message}`)
      }
      const validatedData = result.data

      // Créer l'exercice
      const [exercise] = await tx
        .insert(exercises)
        .values({
          wordId,
          type: validatedData.type,
          level: validatedData.level
        })
        .returning({ id: exercises.id })

      // Traitement des questions DE -> FR
      if (validatedData.de_to_fr) {
        const [question] = await tx
          .insert(exerciseQuestions)
          .values({
            exerciseId: exercise.id,
            direction: 'de_to_fr',
            questionDe: validatedData.de_to_fr.question.de,
            questionFr: validatedData.de_to_fr.question.fr,
            wordToTranslate: validatedData.de_to_fr.word_to_translate,
            correctAnswer: validatedData.de_to_fr.correct_answer
          })
          .returning({ id: exerciseQuestions.id })

        // Ajout des options
        const options = validatedData.de_to_fr.options.map((option) => ({
          questionId: question.id,
          optionText: option,
          isCorrect: option === validatedData.de_to_fr.correct_answer
        }))
        await tx.insert(exerciseOptions).values(options)
      }

      // Traitement des questions FR -> DE
      if (validatedData.fr_to_de) {
        const [question] = await tx
          .insert(exerciseQuestions)
          .values({
            exerciseId: exercise.id,
            direction: 'fr_to_de',
            questionDe: validatedData.fr_to_de.question.de,
            questionFr: validatedData.fr_to_de.question.fr,
            wordToTranslate: validatedData.fr_to_de.word_to_translate,
            correctAnswer: validatedData.fr_to_de.correct_answer
          })
          .returning({ id: exerciseQuestions.id })

        // Ajout des options
        const options = validatedData.fr_to_de.options.map((option) => ({
          questionId: question.id,
          optionText: option,
          isCorrect: option === validatedData.fr_to_de.correct_answer
        }))
        await tx.insert(exerciseOptions).values(options)
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new TypeError(`Données d'exercice invalides: ${error.message}`)
      }
      throw error
    }
  }

  private mapVideoFromDb(dbVideo: typeof videos.$inferSelect): Video {
    return {
      id: dbVideo.id,
      title: dbVideo.title,
      originalFilename: dbVideo.originalFilename,
      filePath: dbVideo.filePath,
      fileSize: dbVideo.fileSize || 0,
      language: dbVideo.language,
      transcriptionStatus: dbVideo.transcriptionStatus ?? 'pending',
      queueJobId: dbVideo.queueJobId || undefined,
      errorMessage: dbVideo.errorMessage || undefined,
      tempInfoFile: dbVideo.tempInfoFile || undefined,
      transcriptionFile: dbVideo.transcriptionFile || undefined,
      createdAt: dbVideo.createdAt || undefined,
      updatedAt: dbVideo.updatedAt || undefined,
      processedAt: dbVideo.processedAt || undefined
    }
  }

  async insertExercises(exercises: z.infer<typeof ExerciseDataSchema>[], word: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Trouver l'ID du mot
      const [wordEntry] = await tx
        .select({ id: wordEntries.id })
        .from(wordEntries)
        .where(eq(wordEntries.word, word))
        .limit(1)

      if (!wordEntry) {
        throw new Error(`Word not found: ${word}`)
      }

      await this.insertExercisesTx(tx, exercises, wordEntry.id)
    })
  }

  async insertPronunciations(pronunciationData: z.infer<typeof PronunciationSchema>[], word: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Trouver l'ID du mot
      const [wordEntry] = await tx
        .select({ id: wordEntries.id })
        .from(wordEntries)
        .where(eq(wordEntries.word, word))
        .limit(1)

      if (!wordEntry) {
        throw new Error(`Word not found: ${word}`)
      }

      const validatedPronunciations = pronunciationData.map((p) => PronunciationSchema.parse(p))
      const pronunciationValues = validatedPronunciations.map((p) => ({
        wordId: wordEntry.id,
        filePath: p.file,
        type: p.type,
        language: p.language
      }))

      await tx.insert(pronunciations).values(pronunciationValues)
    })
  }
}
