/* eslint-disable no-console */
import type { Context, Probot } from 'probot'
import metadata from 'probot-metadata'

const linkCliPrRegex = /\/linkpr.*/gmi

const defaultBranch = 'main'
const defaultCapgoCloneRef = 'Cap-go/capgo'
const defaultCliCloneRef = 'Cap-go/CLI'

const metadataRegex = /(\n\n|\r\n)<!-- probot = (.*) -->/

export default (app: Probot) => {
  app.on('issue_comment', async (context: Context<'issue_comment'>) => {
    if (context.payload.action === 'deleted')
      return

    if (context.payload.issue.pull_request === undefined) {
      console.log('Not a pull request')
      return
    }

    const pullRequestUrl = context.payload.issue.pull_request.url
    if (pullRequestUrl === undefined) {
      console.log('No pull request URL')
      return
    }

    if (context.payload.comment.user.type === 'Bot')
      return

    const repoUrl = context.payload.issue.repository_url
    let type: 'capgo' | 'cli' | undefined
    if (repoUrl.endsWith('/CLI')) {
      type = 'cli'
    }
    else if (repoUrl.endsWith('/capgo')) {
      type = 'capgo'
    }
    else {
      console.log('Not a capgo or CLI repository', repoUrl)
      return
    }

    console.log('type', type)

    const body = context.payload.comment.body
    const foundLink = body.match(linkCliPrRegex)

    if (!foundLink) {
      console.log(`No match found in ${body}`)
      return
    }

    if (foundLink) {
      for (const match of foundLink) {
        console.log('Found LINK', match, match.split(' '))
        const args = match.split(' ').slice(1, undefined)
        if (args.length < 1) {
          console.log('No arguments')
          await reactWith(context, '-1')
          return
        }

        const urlString = args[0]
        const lowerUrlString = urlString.toLowerCase()
        if (lowerUrlString === 'none' || lowerUrlString === 'clear' || lowerUrlString === 'null') {
          await metadata(context as any).set('cli_pr', {})
          await reactWith(context, '+1')
          return
        }

        const parsedUrl = await parsePrUrl(urlString)
        if (!parsedUrl) {
          await reactWith(context, '-1')
          return
        }

        // as any due to "to complex union type"
        await metadata(context as any).set('cli_pr', urlString)
      }
    }

    await reactWith(context, '+1')
  })

  app.on('check_run.rerequested', async (context: Context<'check_run.rerequested'>) => {
    await handleCheckSuite(context)
  })

  app.on('check_suite.requested', async (context: Context<'check_suite.requested'>) => {
    await handleCheckSuite(context)
  })

  app.on('check_suite.rerequested', async (context: Context<'check_suite.rerequested'>) => {
    await handleCheckSuite(context)
  })
}

async function handleCheckSuite(context: Context<'check_suite.requested'> | Context<'check_suite.rerequested'> | Context<'check_run.rerequested'>) {
  const checkSuite = ('check_suite' in context.payload) ? context.payload.check_suite : context.payload.check_run.check_suite
  const pullRequest = checkSuite.pull_requests
  const headBranch = checkSuite.head_branch

  if (pullRequest.length === 0 || headBranch === null || pullRequest.length > 1) {
    console.log('No pull request or branch (perhaps a fork?)', pullRequest.length, headBranch)
    return
  }

  const repository = context.payload.repository
  const type = repository.name.includes('CLI') ? 'cli' : 'capgo'

  const pullRequestUrl = pullRequest[0].url
  const pullRequestObject = await (context.octokit.request(pullRequestUrl) as any as ReturnType<typeof context.octokit.pulls.get>)
  const issueUrl = pullRequestObject.data.issue_url
  console.log(issueUrl)

  // Willing to risk it, sure this HAS to work right?
  // https://github.com/probot/metadata/blob/47a19638cbfc41218119078b0f82c755e518fbbd/index.js#L10
  const issue = await (context.octokit.request(issueUrl) as any as ReturnType<typeof context.octokit.issues.get>)
  const body = issue.data.body
  console.log(body)

  const match = body && body.match(metadataRegex)
  const prefix = context.payload.installation?.id
  if (!prefix) {
    console.log('no prefix')
    return
  }

  if (match) {
    // TODO: change this app ID to the correct one
    const data = JSON.parse(match[2])[prefix]
    const cliPrUrl = data && data.cli_pr

    if (cliPrUrl && typeof cliPrUrl === 'string') {
      const parsedUrl = await parsePrUrl(cliPrUrl)

      if (!parsedUrl) {
        console.log('Invalid PR URL')
        return
      }

      const pullRequest = await context.octokit.pulls.get({
        owner: parsedUrl.owner,
        repo: parsedUrl.repo,
        pull_number: parsedUrl.pullNumber,
      })

      const cloneRef = pullRequest.data.head.repo?.full_name
      const branch = pullRequest.data.head.ref

      if (cloneRef === undefined) {
        console.log('No clone URL')
        return
      }

      await startWorkflow(context, repository.owner.login, repository.name, branch, cloneRef, checkSuite.head_sha, type)
      return
    }
  }

  // Well, let's create a check run shall we?
  await startWorkflow(context, repository.owner.login, repository.name, defaultBranch, type === 'cli' ? defaultCliCloneRef : defaultCapgoCloneRef, checkSuite.head_sha, type)
}

async function startWorkflow(
  context: Context<'check_suite.requested'> | Context<'check_suite.rerequested'> | Context<'check_run.rerequested'>,
  owner: string,
  repo: string,
  branch: string,
  cloneRef: string,
  sha256: string,
  currentRepo: 'capgo' | 'cli',
  testsToRun = 'all',
) {
  console.log('Starting workflow', owner, repo, branch, cloneRef, sha256, currentRepo, testsToRun)
  await context.octokit.checks.create({
    owner,
    repo,
    name: 'E2E tests',
    status: 'queued',
    head_sha: sha256,
    output: {
      summary: '',
      title: 'Starting E2E workflow',
    },
  })

  await context.octokit.actions.createWorkflowDispatch({
    owner: 'Cap-go',
    repo: 'github-bot',
    workflow_id: 'test.yml',
    inputs: {
      capgo_clone_url: currentRepo === 'capgo' ? cloneRef : defaultCapgoCloneRef,
      capgo_clone_branch: currentRepo === 'capgo' ? branch : defaultBranch,
      cli_clone_url: currentRepo === 'cli' ? cloneRef : defaultCliCloneRef,
      cli_clone_branch: currentRepo === 'cli' ? branch : defaultBranch,
      comment_url: 'comment.data.url',
      tests_to_run: testsToRun,
      commit_sha: sha256,
      repo_owner: owner,
      repo_name: repo,
    },
    ref: 'main',
  })
}

async function parsePrUrl(urlString: string): Promise<{ owner: string; repo: string; pullNumber: number } | undefined> {
  let url: URL | undefined
  try {
    url = new URL(urlString)
  }
  catch (error) {
    console.log('Invalid URL', urlString)
    return undefined
  }

  console.log('URL', url)
  if (url.hostname !== 'github.com') {
    console.log('Invalid hostname', url.hostname)
    return undefined
  }

  const pathName = url.pathname
  if (pathName.length === 0)
    console.log('Invalid (to short) pathname', pathName)

  const pathParts = pathName.split('/')
  if (pathParts.length < 5)
    console.log('Invalid pathname', pathName)

  console.log('Path parts', pathParts)
  // This parses the pathParts, but it's not very readable
  // Every _{number} is a part of the path that we don't care about
  const [_1, owner, repo, _2, number] = pathParts
  console.log(owner, repo, number)

  const pullNumber = Number.parseInt(number)
  if (Number.isNaN(pullNumber)) {
    console.log('Invalid pull number', number)
    return undefined
  }

  return {
    owner,
    repo,
    pullNumber,
  }
}

async function reactWith(context: Context<'issue_comment'>, reaction: '+1' | '-1') {
  const reactionUrl = context.payload.comment.reactions.url
  await context.octokit.request(reactionUrl, {
    method: 'POST',
    data: {
      content: reaction,
    },
  })
}
