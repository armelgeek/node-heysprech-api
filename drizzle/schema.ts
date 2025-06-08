import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar
} from 'drizzle-orm/pg-core'

export const categoryType = pgEnum('category_type', ['video', 'exercise'])
export const exerciseType = pgEnum('exercise_type', ['multiple_choice_pair'])
export const languageDirection = pgEnum('language_direction', ['de_to_fr', 'fr_to_de'])
export const languageLevel = pgEnum('language_level', ['beginner', 'intermediate', 'advanced'])
export const processingStatus = pgEnum('processing_status', ['started', 'completed', 'failed'])
export const transcriptionStatus = pgEnum('transcription_status', ['pending', 'processing', 'completed', 'failed'])
export const videoCategory = pgEnum('video_category', [
  'vocabulary',
  'grammar',
  'conversation',
  'pronunciation',
  'culture',
  'news',
  'other'
])
export const videoDifficulty = pgEnum('video_difficulty', ['beginner', 'intermediate', 'advanced'])

export const verifications = pgTable('verifications', {
  id: text().primaryKey().notNull(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }),
  updatedAt: timestamp('updated_at', { mode: 'string' })
})

export const users = pgTable(
  'users',
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    firstname: text(),
    lastname: text(),
    email: text().notNull(),
    emailVerified: boolean('email_verified').notNull(),
    image: text(),
    role: text().default('user').notNull(),
    banned: boolean().default(false).notNull(),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { mode: 'string' }),
    isAdmin: boolean('is_admin').default(false).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull()
  },
  (table) => [unique('users_email_unique').on(table.email)]
)

export const accounts = pgTable(
  'accounts',
  {
    id: text().primaryKey().notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { mode: 'string' }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { mode: 'string' }),
    scope: text(),
    password: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'accounts_user_id_users_id_fk'
    })
  ]
)

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: text().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    action: text().notNull(),
    timestamp: timestamp({ mode: 'string' }).defaultNow().notNull(),
    ipAddress: varchar('ip_address', { length: 45 })
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'activity_logs_user_id_users_id_fk'
    }).onDelete('cascade')
  ]
)

export const roles = pgTable(
  'roles',
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    description: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull()
  },
  (table) => [unique('roles_name_unique').on(table.name)]
)

export const roleResources = pgTable(
  'role_resources',
  {
    id: text().primaryKey().notNull(),
    roleId: text('role_id').notNull(),
    resourceType: text('resource_type').notNull(),
    actions: jsonb().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: 'role_resources_role_id_roles_id_fk'
    }).onDelete('cascade')
  ]
)

export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey().notNull(),
    expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
    token: text().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull(),
    impersonatedBy: text('impersonated_by')
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_id_users_id_fk'
    }),
    foreignKey({
      columns: [table.impersonatedBy],
      foreignColumns: [users.id],
      name: 'sessions_impersonated_by_users_id_fk'
    }),
    unique('sessions_token_unique').on(table.token)
  ]
)

export const userRoles = pgTable(
  'user_roles',
  {
    id: text().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'user_roles_user_id_users_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: 'user_roles_role_id_roles_id_fk'
    }).onDelete('cascade')
  ]
)

export const videoSegments = pgTable(
  'video_segments',
  {
    id: serial().primaryKey().notNull(),
    videoId: integer('video_id').notNull(),
    startTime: integer('start_time').notNull(),
    endTime: integer('end_time').notNull(),
    transcriptDe: text('transcript_de').notNull(),
    transcriptFr: text('transcript_fr'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'video_segments_video_id_videos_id_fk'
    }).onDelete('cascade')
  ]
)

export const audioSegments = pgTable(
  'audio_segments',
  {
    id: serial().primaryKey().notNull(),
    videoId: integer('video_id').notNull(),
    startTime: integer('start_time').notNull(),
    endTime: integer('end_time').notNull(),
    text: text().notNull(),
    language: varchar({ length: 10 }).notNull(),
    translation: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'audio_segments_video_id_videos_id_fk'
    }).onDelete('cascade')
  ]
)

export const processingLogs = pgTable(
  'processing_logs',
  {
    id: serial().primaryKey().notNull(),
    videoId: integer('video_id').notNull(),
    step: varchar({ length: 100 }).notNull(),
    status: processingStatus().notNull(),
    message: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'processing_logs_video_id_videos_id_fk'
    }).onDelete('cascade')
  ]
)

export const wordSegments = pgTable(
  'word_segments',
  {
    id: serial().primaryKey().notNull(),
    audioSegmentId: integer('audio_segment_id').notNull(),
    word: varchar({ length: 255 }).notNull(),
    startTime: integer('start_time').notNull(),
    endTime: integer('end_time').notNull(),
    confidenceScore: integer('confidence_score').notNull(),
    positionInSegment: integer('position_in_segment').notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.audioSegmentId],
      foreignColumns: [audioSegments.id],
      name: 'word_segments_audio_segment_id_audio_segments_id_fk'
    }).onDelete('cascade')
  ]
)

export const videoCategories = pgTable(
  'video_categories',
  {
    id: serial().primaryKey().notNull(),
    name: varchar({ length: 100 }).notNull(),
    type: categoryType().default('video').notNull(),
    description: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [unique('video_categories_name_unique').on(table.name)]
)

export const videos = pgTable('videos', {
  id: serial().primaryKey().notNull(),
  title: varchar({ length: 500 }).notNull(),
  originalFilename: varchar('original_filename', { length: 500 }).notNull(),
  filePath: varchar('file_path', { length: 1000 }).notNull(),
  fileSize: integer('file_size'),
  duration: integer(),
  language: varchar({ length: 10 }).default('de').notNull(),
  transcriptionStatus: transcriptionStatus('transcription_status').default('pending'),
  queueJobId: varchar('queue_job_id', { length: 255 }),
  errorMessage: text('error_message'),
  tempInfoFile: varchar('temp_info_file', { length: 1000 }),
  transcriptionFile: varchar('transcription_file', { length: 1000 }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  processedAt: timestamp('processed_at', { mode: 'string' }),
  category: videoCategory().default('other').notNull(),
  difficulty: videoDifficulty().default('intermediate').notNull(),
  youtubeId: varchar('youtube_id', { length: 11 })
})

export const difficultyLevels = pgTable(
  'difficulty_levels',
  {
    id: serial().primaryKey().notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    rank: integer().notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [unique('difficulty_levels_name_unique').on(table.name)]
)

export const completedSegments = pgTable(
  'completed_segments',
  {
    id: serial().primaryKey().notNull(),
    videoId: integer('video_id').notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    segmentId: integer('segment_id').notNull(),
    completedAt: timestamp('completed_at', { mode: 'string' }).defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'completed_segments_video_id_videos_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.segmentId],
      foreignColumns: [audioSegments.id],
      name: 'completed_segments_segment_id_audio_segments_id_fk'
    }).onDelete('cascade')
  ]
)

export const videoWords = pgTable(
  'video_words',
  {
    id: serial().primaryKey().notNull(),
    videoId: integer('video_id').notNull(),
    segmentId: integer('segment_id'),
    wordDe: text('word_de').notNull(),
    wordFr: text('word_fr').notNull(),
    contextDe: text('context_de'),
    contextFr: text('context_fr'),
    difficultyLevel: integer('difficulty_level').default(1).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'video_words_video_id_videos_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.segmentId],
      foreignColumns: [videoSegments.id],
      name: 'video_words_segment_id_video_segments_id_fk'
    }).onDelete('set null')
  ]
)

export const exercises = pgTable('exercises', {
  id: serial().primaryKey().notNull(),
  wordId: integer('word_id').notNull(),
  type: exerciseType().notNull(),
  level: languageLevel().notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  videoId: integer('video_id').notNull(),
  metadata: jsonb()
})

export const exerciseQuestions = pgTable(
  'exercise_questions',
  {
    id: serial().primaryKey().notNull(),
    exerciseId: integer('exercise_id').notNull(),
    direction: languageDirection().notNull(),
    questionDe: text('question_de').notNull(),
    questionFr: text('question_fr').notNull(),
    wordToTranslate: varchar('word_to_translate', { length: 255 }).notNull(),
    correctAnswer: varchar('correct_answer', { length: 255 }).notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.exerciseId],
      foreignColumns: [exercises.id],
      name: 'exercise_questions_exercise_id_exercises_id_fk'
    }).onDelete('cascade')
  ]
)

export const exerciseOptions = pgTable(
  'exercise_options',
  {
    id: serial().primaryKey().notNull(),
    questionId: integer('question_id').notNull(),
    optionText: varchar('option_text', { length: 255 }).notNull(),
    isCorrect: boolean('is_correct').default(false).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.questionId],
      foreignColumns: [exerciseQuestions.id],
      name: 'exercise_options_question_id_exercise_questions_id_fk'
    }).onDelete('cascade')
  ]
)

export const wordEntries = pgTable('word_entries', {
  id: serial().primaryKey().notNull(),
  word: varchar({ length: 255 }).notNull(),
  language: varchar({ length: 10 }).notNull(),
  translations: jsonb().notNull(),
  examples: jsonb().notNull(),
  level: languageLevel().notNull(),
  metadata: jsonb(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
})

export const pronunciations = pgTable(
  'pronunciations',
  {
    id: serial().primaryKey().notNull(),
    wordId: integer('word_id').notNull(),
    filePath: varchar('file_path', { length: 1000 }).notNull(),
    type: varchar({ length: 50 }).notNull(),
    language: varchar({ length: 10 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
  },
  (table) => [
    foreignKey({
      columns: [table.wordId],
      foreignColumns: [wordEntries.id],
      name: 'pronunciations_word_id_word_entries_id_fk'
    }).onDelete('cascade')
  ]
)

export const userProgress = pgTable(
  'user_progress',
  {
    id: serial().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    level: integer().default(1).notNull(),
    totalXp: integer('total_xp').default(0).notNull(),
    currentStreak: integer('current_streak').default(0).notNull(),
    lastActivity: timestamp('last_activity', { mode: 'string' }).defaultNow(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'user_progress_user_id_users_id_fk'
    }).onDelete('cascade')
  ]
)

export const userVocabulary = pgTable(
  'user_vocabulary',
  {
    id: serial().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    wordId: integer('word_id').notNull(),
    videoId: integer('video_id').notNull(),
    masteryLevel: integer('mastery_level').default(0).notNull(),
    nextReview: timestamp('next_review', { mode: 'string' }),
    lastReviewed: timestamp('last_reviewed', { mode: 'string' }),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'user_vocabulary_user_id_users_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.wordId],
      foreignColumns: [videoWords.id],
      name: 'user_vocabulary_word_id_video_words_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'user_vocabulary_video_id_videos_id_fk'
    }).onDelete('cascade')
  ]
)

export const videoExercises = pgTable(
  'video_exercises',
  {
    id: serial().primaryKey().notNull(),
    videoId: integer('video_id').notNull(),
    segmentId: integer('segment_id'),
    type: text().notNull(),
    questionDe: text('question_de').notNull(),
    questionFr: text('question_fr'),
    correctAnswer: text('correct_answer').notNull(),
    options: jsonb(),
    difficultyLevel: integer('difficulty_level').default(1).notNull(),
    points: integer().default(10).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'video_exercises_video_id_videos_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.segmentId],
      foreignColumns: [videoSegments.id],
      name: 'video_exercises_segment_id_video_segments_id_fk'
    }).onDelete('set null')
  ]
)

export const videoProgress = pgTable(
  'video_progress',
  {
    id: serial().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    videoId: integer('video_id').notNull(),
    watchedSeconds: integer('watched_seconds').default(0).notNull(),
    lastSegmentWatched: integer('last_segment_watched'),
    isCompleted: boolean('is_completed').default(false).notNull(),
    completedExercises: integer('completed_exercises').default(0).notNull(),
    masteredWords: integer('mastered_words').default(0).notNull(),
    lastWatched: timestamp('last_watched', { mode: 'string' }).defaultNow(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'video_progress_user_id_users_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'video_progress_video_id_videos_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.lastSegmentWatched],
      foreignColumns: [videoSegments.id],
      name: 'video_progress_last_segment_watched_video_segments_id_fk'
    }).onDelete('set null')
  ]
)

export const exerciseCompletions = pgTable(
  'exercise_completions',
  {
    id: serial().primaryKey().notNull(),
    userId: text('user_id').notNull(),
    exerciseId: integer('exercise_id').notNull(),
    videoId: integer('video_id').notNull(),
    score: integer().notNull(),
    isCorrect: boolean('is_correct').default(false).notNull(),
    completedAt: timestamp('completed_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'exercise_completions_user_id_users_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.exerciseId],
      foreignColumns: [exercises.id],
      name: 'exercise_completions_exercise_id_exercises_id_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.videoId],
      foreignColumns: [videos.id],
      name: 'exercise_completions_video_id_videos_id_fk'
    }).onDelete('cascade')
  ]
)
