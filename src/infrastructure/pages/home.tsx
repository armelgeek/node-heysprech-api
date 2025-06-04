import { Hono } from 'hono'

export const Home = new Hono()

export const Meteors = ({ number }: { number: number }) => {
  return (
    <>
      {Array.from({ length: number || 20 }, (_, idx) => (
        <span
          key={idx}
          class="meteor animate-[meteorAnimation_3s_linear_infinite] absolute h-1 w-1 rounded-[9999px] shadow-[0_0_0_1px_#ffffff10] rotate-[215deg]"
          style={{
            top: 0,
            left: `${Math.floor(Math.random() * (400 - -400) + -400)}px`,
            animationDelay: `${Math.random() * (0.8 - 0.2) + 0.2}s`,
            animationDuration: `${Math.floor(Math.random() * (10 - 2) + 2)}s`
          }}
        />
      ))}
    </>
  )
}

Home.get('/', (c) => {
  const title = 'Sprech Audio Processing'
  const description = 'Upload and process audio files with Sprech for high-quality transcription and analysis.'

  return c.html(
    <html>
      <head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta charset="utf-8" />
        <meta name="description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:title" content={title} />
        <meta property="twitter:description" content={description} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&family=Outfit:wght@100..900&display=swap"
          rel="stylesheet"
        />
        <script src="https://cdn.tailwindcss.com" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
            * { font-family: 'Lexend', sans-serif; } 
            @keyframes borderAnimation {
              0%, 100% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
            }
            @keyframes meteorAnimation {
              0% { transform: rotate(215deg) translateX(0); opacity: 1; }
              70% { opacity: 1; }
              100% { transform: rotate(215deg) translateX(-500px); opacity: 0; }
            }
            .meteor::before {
              content: '';
              position: absolute;
              top: 50%;
              transform: translateY(-50%);
              width: 50px;
              height: 1px;
              background: linear-gradient(90deg, #64748b, transparent);
            }
            .animate-meteor-effect {
              animation-name: meteorAnimation;
            }`
          }}
        />
      </head>
      <body class="min-h-screen bg-black overflow-x-hidden flex flex-col">
        <main class="flex-1 flex flex-col gap-4 max-w-4xl mx-auto p-4 sm:p-8 relative">
          <div class="relative">
            <div class="flex flex-col gap-0.5">
              <span class="text-xs uppercase bg-opacity-15 rounded text-center max-w-fit px-2 py-1 font-bold tracking-wide bg-purple-500 text-purple-500">
                Audio Processing
              </span>
              <span class="text-neutral-200 font-bold text-3xl sm:text-4xl md:text-5xl">Upload and Process Audio</span>
              <span class="text-neutral-500 max-w-xl">{description}</span>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-8 gap-4">
            <div class="sm:col-span-8 p-4 sm:p-8 bg-white bg-opacity-5 rounded-lg">
              <form
                action="/api/v1/upload-audio"
                method="post"
                enctype="multipart/form-data"
                class="flex flex-col gap-4"
              >
                <div>
                  <label class="block text-sm font-medium text-neutral-200">Audio File</label>
                  <input
                    type="file"
                    name="audioFile"
                    accept="audio/*"
                    required
                    class="mt-1 block w-full text-sm text-neutral-300 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-purple-500 file:text-neutral-100 hover:file:bg-purple-600 cursor-pointer"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-neutral-200">Title (Optional)</label>
                  <input
                    type="text"
                    name="title"
                    class="mt-1 block w-full rounded-md bg-white bg-opacity-5 border-transparent focus:border-purple-500 focus:bg-opacity-10 focus:ring-0 text-neutral-200"
                    placeholder="Enter a title for your audio file"
                  />
                </div>
                <button
                  type="submit"
                  class="inline-flex justify-center rounded-md border border-transparent bg-purple-500 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                >
                  Upload and Process
                </button>
              </form>
            </div>

            <div class="sm:col-span-8 p-4 sm:p-8 bg-white bg-opacity-5 rounded-lg">
              <h2 class="text-xl font-bold text-neutral-200 mb-4">Recent Uploads</h2>
              <div id="recentUploads" class="space-y-4">
                Loading...
              </div>
            </div>
          </div>

          <script
            dangerouslySetInnerHTML={{
              __html: `
                async function updateRecentUploads() {
                  try {
                    const response = await fetch('/api/videos/recent');
                    const videos = await response.json();
                    
                    const uploadsHtml = videos.map(video => \`
                      <div class="p-4 bg-white bg-opacity-5 rounded-lg">
                        <div class="flex justify-between items-start">
                          <div>
                            <h3 class="text-neutral-200 font-medium">\${video.title}</h3>
                            <p class="text-neutral-500 text-sm">\${video.originalFilename}</p>
                          </div>
                          <span class="px-2 py-1 text-xs rounded bg-\${getStatusColor(video.transcriptionStatus)}-500 bg-opacity-15 text-\${getStatusColor(video.transcriptionStatus)}-500">
                            \${video.transcriptionStatus}
                          </span>
                        </div>
                      </div>
                    \`).join('');
                    
                    document.getElementById('recentUploads').innerHTML = uploadsHtml || 'No recent uploads';
                  } catch (error) {
                    console.error('Error fetching recent uploads:', error);
                  }
                }

                function getStatusColor(status) {
                  switch (status) {
                    case 'completed': return 'green';
                    case 'processing': return 'blue';
                    case 'failed': return 'red';
                    default: return 'yellow';
                  }
                }

                // Update list every 5 seconds
                updateRecentUploads();
                setInterval(updateRecentUploads, 5000);
              `
            }}
          />
        </main>

        <Meteors number={20} />
      </body>
    </html>
  )
})
