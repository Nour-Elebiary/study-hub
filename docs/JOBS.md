# Processing files (the Jobs screen)

The Jobs screen turns files you already uploaded into text you can put in
your notes. Open it from the **Jobs** link at the top of any page.

Light jobs run inside your web browser, on your own computer or phone.
Heavy jobs (scanned PDFs, Office files, video, audio) wait for the **Home
Worker** — a small program on a leader's own computer (see
[WORKER.md](WORKER.md)). Your files are not sent to any outside service.
Your original files are never changed — every job creates something new.

## What you can do

| Job                                | What it does                                                                     | Works on              | Where it runs   |
| ---------------------------------- | -------------------------------------------------------------------------------- | --------------------- | --------------- |
| Read text from a photo (OCR)       | Copies the text out of a photo, in English and/or Arabic                         | Photos and scans      | Your browser    |
| Read text from a scanned PDF (OCR) | Makes a **searchable copy** of a scanned PDF with the text as an invisible layer | PDF files             | The Home Worker |
| Word to Markdown                   | Turns a Word document into editable note text                                    | `.docx` files         | Your browser    |
| Word or PowerPoint to PDF          | Makes a PDF copy of a Word or PowerPoint file                                    | `.docx` and `.pptx`   | The Home Worker |
| Merge PDFs                         | Combines two or more PDFs into one, in the order you pick                        | PDF files             | Your browser    |
| Split a PDF                        | Copies the pages you choose into a new, smaller PDF                              | PDF files             | Your browser    |
| Video to audio (MP3)               | Saves just the sound from a video                                                | Video files           | The Home Worker |
| Compress a video                   | Makes a smaller copy of a video                                                  | Video files           | The Home Worker |
| Audio to text                      | Writes out what is said in a recording, with time stamps                         | Audio and video files | The Home Worker |

## How to start a job

1. Pick what should be done.
2. Pick the course.
3. Pick the file (for Merge PDFs, tick two or more files in the order you
   want them combined).
4. For OCR or Audio to text, choose the languages that appear in the
   picture or the recording.
5. For Split a PDF, write which pages to keep, for example `1-3,5`.
6. Press **Start job**.

## What happens next

- The job first waits (**Waiting**), then runs (**Running**), then is
  **Done**. The list updates by itself — no need to reload the page.
- When a job is done, two things appear in the course:
  - a **draft note** with the result (for text jobs, the text; for file
    jobs, a link to the new file), and
  - the result **file** attached to that note.
- The draft note carries the **auto-text** tag. Machine-made text always
  needs a human check: read it, fix mistakes, then publish the note.
  Students never see drafts.

## The Home Worker

Admins see a badge at the top of the job list: **Home Worker: online** or
**offline**. Online means the worker program checked in within the last
minute and a half.

- Heavy jobs wait until a worker is online. If the badge says offline and
  you have heavy jobs waiting, ask the person whose computer runs the
  worker to start it (or check `worker.log` in its folder).
- Long recordings are split into 10-minute parts, written out with time
  stamps like `[00:10:23]`, and joined back together in order. A part that
  fails is retried by itself; if it never succeeds it is marked in the text
  instead of losing the whole transcription.
- Files that live as a Drive link cannot be processed — the job needs the
  file stored in Study Hub.

## If a job fails

A job that fails tries again by itself — up to three tries, waiting a
little longer each time. If all three tries fail, it shows as **Failed**
with the reason, and you can press **Try again** to start it from the
beginning. You can also press **Cancel** on a waiting or running job.

## Things to know

- **Keep the Jobs screen open while browser jobs run.** The work happens
  in your browser, so if you close the page, waiting jobs stay waiting
  until you come back. If two people have the screen open, they share the
  work — each job runs only once. (Home Worker jobs keep running even when
  everyone closes the page.)
- OCR reads printed text best. Clear photos of clean pages give the best
  results; handwriting, formulas and tables may come out wrong.
- Big or unusual PDFs may be slow — the browser is doing real work.
- Only leaders who may upload in a course can start jobs there. Reviewers
  can see the job list but cannot start jobs.
