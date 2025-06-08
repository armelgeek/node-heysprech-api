import { z } from 'zod'

// Base schema for all exercises
const BaseExerciseSchema = z.object({
  level: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate')
})

// Fill in the blank exercise
export const FillInBlankSchema = BaseExerciseSchema.extend({
  type: z.literal('fill_in_blank'),
  sentence: z.string(),
  blanks: z.array(
    z.object({
      word: z.string(),
      position: z.number(),
      hint: z.string().optional()
    })
  )
})

// Sentence formation exercise
export const SentenceFormationSchema = BaseExerciseSchema.extend({
  type: z.literal('sentence_formation'),
  words: z.array(z.string()),
  correctSentence: z.string(),
  hint: z.string().optional()
})

// Listening comprehension exercise
export const ListeningComprehensionSchema = BaseExerciseSchema.extend({
  type: z.literal('listening_comprehension'),
  audioUrl: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      correctAnswer: z.string(),
      options: z.array(z.string())
    })
  )
})

// Phrase matching exercise
export const PhraseMatchingSchema = BaseExerciseSchema.extend({
  type: z.literal('phrase_matching'),
  pairs: z.array(
    z.object({
      german: z.string(),
      french: z.string()
    })
  )
})

// Schema for exercise question data (for multiple choice)
export const ExerciseQuestionSchema = z.object({
  question: z.object({
    de: z.string(),
    fr: z.string()
  }),
  word_to_translate: z.string(),
  correct_answer: z.string(),
  options: z.array(z.string())
})

// Multiple choice pair exercise (existing type)
export const MultipleChoicePairSchema = BaseExerciseSchema.extend({
  type: z.literal('multiple_choice_pair'),
  de_to_fr: ExerciseQuestionSchema,
  fr_to_de: ExerciseQuestionSchema
})

// Combined exercise data schema
export const ExerciseDataSchema = z.discriminatedUnion('type', [
  MultipleChoicePairSchema,
  FillInBlankSchema,
  SentenceFormationSchema,
  ListeningComprehensionSchema,
  PhraseMatchingSchema
])

// Schema for pronunciation data
export const PronunciationSchema = z.object({
  file: z.string(),
  type: z.string(),
  language: z.string()
})

// Schema for media data
export const MediaSchema = z.object({
  type: z.enum(['audio', 'image', 'video']),
  url: z.string()
})

// Schema for hint data
export const HintSchema = z.object({
  text: z.string(),
  type: z.enum(['grammar', 'vocabulary', 'usage', 'pronunciation']).optional()
})

// Schema for vocabulary item data
export const VocabularyEntrySchema = z.object({
  occurrences: z.array(
    z.object({
      segmentId: z.number(),
      startTime: z.number(),
      endTime: z.number(),
      confidenceScore: z.number()
    })
  ),
  metadata: z.any(),
  translations: z.array(z.string()),
  examples: z.array(z.string()),
  level: z.string(),
  exercises: ExerciseDataSchema,
  pronunciations: z.array(PronunciationSchema)
})

// Types exports
export type FillInBlankExercise = z.infer<typeof FillInBlankSchema>
export type SentenceFormationExercise = z.infer<typeof SentenceFormationSchema>
export type ListeningComprehensionExercise = z.infer<typeof ListeningComprehensionSchema>
export type PhraseMatchingExercise = z.infer<typeof PhraseMatchingSchema>
export type ExerciseQuestion = z.infer<typeof ExerciseQuestionSchema>
export type ExerciseData = z.infer<typeof ExerciseDataSchema>
export type MultipleChoicePairExercise = z.infer<typeof MultipleChoicePairSchema>
export type MediaData = z.infer<typeof MediaSchema>
export type HintData = z.infer<typeof HintSchema>
export type PronunciationData = z.infer<typeof PronunciationSchema>
export type VocabularyEntry = z.infer<typeof VocabularyEntrySchema>
