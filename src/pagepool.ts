import type { BrowserContext, Page, Response } from 'playwright';

export type Job = {
  url: string;
  timeout?: number;

  matcher?: (res: Response) => boolean;
  onComplete?: (result: unknown) => void;
};

export class PagePool {
  /**
   * Flags whether the pool is destroyed or not.
   */
  private isDestroyed = false;

  /**
   * Pages that are currently being used by the pool.
   *
   * @see {setPages()}
   */
  private pages: Page[] = [];

  /**
   * Jobs that are currently being executed by the pool.
   *
   * @see {execute()}
   */
  private jobs: Job[] = [];

  /**
   * Jobs that are waiting to be executed by the pool.
   *
   * @see {execute()}
   *
   */
  private queuedJobs: Job[] = [];

  constructor(private ctx: BrowserContext) {}

  private getMaxExecutableJob() {
    return this.pages.length;
  }

  private hasNoPages() {
    return this.pages.length === 0;
  }

  private hasNoJobs() {
    return this.jobs.length === 0;
  }

  private canAddNewJob() {
    return this.jobs.length < this.getMaxExecutableJob();
  }

  async setPages(count: number) {
    if (this.isDestroyed || !this.hasNoJobs()) {
      // couldn't resize the pages
      return this;
    }

    const newPages = Array(count)
      .fill(null)
      .map(() => this.ctx.newPage());

    this.pages = await Promise.all(newPages);

    return this;
  }

  addJob(job: Job) {
    if (this.isDestroyed) {
      return;
    }

    if (this.hasNoPages()) {
      return;
    }

    if (this.canAddNewJob()) {
      this.jobs.push(job);
      return;
    }

    this.queuedJobs.push(job);
    return this;
  }

  async execute() {
    if (this.isDestroyed || this.hasNoJobs() || this.hasNoPages()) {
      return;
    }

    await this.executeJobs();
    if (this.prepareForNextJobs()) {
      this.execute();
    }
  }

  async destroy() {
    this.isDestroyed = true;

    const promises = this.pages.map((page) => page.close());
    await Promise.allSettled(promises);

    this.jobs = [];
    this.queuedJobs = [];
  }

  private async executeJobs() {
    if (this.isDestroyed || this.hasNoJobs()) {
      return;
    }

    const executableJobs =
      this.jobs.map(async (job, idx) => {
        const page = this.pages[idx];

        const response = page.waitForResponse((r) => job.matcher?.(r) || false, { timeout: job.timeout });

        await page.goto(job.url, { timeout: job.timeout });

        const result = await (await response).json();
        job.onComplete?.(result);
      }) || [];

    await Promise.allSettled(executableJobs);
  }

  private prepareForNextJobs() {
    this.jobs = [];

    for (let i = 0; i < this.getMaxExecutableJob(); i++) {
      const nextJob = this.queuedJobs[0];
      if (!nextJob) {
        // queued jobs is empty
        break;
      }

      const job = this.queuedJobs.shift();
      this.jobs.push(job);
    }

    return !this.hasNoJobs();
  }
}
