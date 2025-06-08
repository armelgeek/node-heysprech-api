-- Add video_id column to exercises table
ALTER TABLE "exercises" ADD COLUMN "video_id" integer NOT NULL DEFAULT 0;

-- Add foreign key constraint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_video_id_videos_id_fk" 
FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE cascade ON UPDATE no action;
