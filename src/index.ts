/* eslint-disable no-console */
import type { Context, Probot } from 'probot'
import metadata from 'probot-metadata'
import { z } from 'zod'

const linkCliPrRegex = /\/linkpr.*/gmi

const defaultBranch = 'main'
const defaultCapgoCloneRef = 'Cap-go/capgo'
const defaultCliCloneRef = 'Cap-go/CLI'
const mainRepoName = 'WcaleNieWolny'
const githubBotRepoName = 'temp-capgo-cicd'

const metadataRegex = /(\n\n|\r\n)<!-- probot = (.*) -->/
const rerunMetadataRegex = /(?<=<!--- ).+?(?= -->)/

const rerunMetadataSchema = z.object({
  capgo_clone_url: z.string(),
  capgo_clone_branch: z.string(),
  cli_clone_url: z.string(),
  cli_clone_branch: z.string(),
  tests_to_run: z.string(),
  commit_sha: z.string(),
  repo_owner: z.string(),
  repo_name: z.union([z.literal('capgo'), z.literal('CLI')]).transform(value => value === 'capgo' ? 'capgo' : 'cli'),
})

type ContextType = Context<'pull_request.synchronize'> | Context<'check_suite.rerequested'> | Context<'check_run.rerequested'> | Context<'pull_request.opened'>

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
    console.log('Rerun workflow')
    await restartWorkflow(context, context.payload.check_run)
  })

  // app.on('check_suite.requested', async (context: Context<'check_suite.requested'>) => {
  //   await handleCheckSuite(context)
  // })

  app.on('check_suite.rerequested', async (context: Context<'check_suite.rerequested'>) => {
    const checkRunUrl = context.payload.check_suite.check_runs_url
    const checkRuns = await (context.octokit.request(checkRunUrl) as any as ReturnType<typeof context.octokit.checks.listForSuite>)

    const prefix = context.payload.check_suite?.app?.id

    if (!prefix) {
      console.log('no prefix')
      return
    }

    const ourCheckRun = checkRuns.data.check_runs.find((checkRun => checkRun?.app?.id === prefix))
    // This any is dangerous, tho RIGHT now it does work
    await restartWorkflow(context, ourCheckRun as any)
  })

  app.on('pull_request.synchronize', async (context: Context<'pull_request.synchronize'>) => {
    const pullRequests = [context.payload.pull_request]
    const headBranch = context.payload.pull_request.head.ref
    const headSha = context.payload.after

    await handleCheckSuite(context, pullRequests, headBranch, headSha)
  })

  app.on('pull_request.opened', async (context: Context<'pull_request.opened'>) => {
    const pullRequests = [context.payload.pull_request]
    const headBranch = context.payload.pull_request.head.ref
    const headSha = context.payload.pull_request.head.sha

    await handleCheckSuite(context, pullRequests, headBranch, headSha)
  })
}

async function handleCheckSuite(
  context: ContextType,
  pullRequests: { url: string }[],
  headBranch: string,
  headSha: string,
) {
  if (pullRequests.length === 0 || headBranch === null || pullRequests.length > 1) {
    console.log('No pull request or branch (perhaps a fork?)', pullRequests.length, headBranch)
    return
  }

  const repository = context.payload.repository
  const type = repository.name.includes('CLI') ? 'cli' : 'capgo'

  const pullRequestUrl = pullRequests[0].url
  const pullRequestObject = await (context.octokit.request(pullRequestUrl) as any as ReturnType<typeof context.octokit.pulls.get>)
  const issueUrl = pullRequestObject.data.issue_url
  const headRepo = pullRequestObject.data.head.repo
  console.log(issueUrl)

  if (!headRepo) {
    console.log('no head repo')
    return
  }

  // Willing to risk it, sure this HAS to work right?
  // https://github.com/probot/metadata/blob/47a19638cbfc41218119078b0f82c755e518fbbd/index.js#L10
  const issue = await (context.octokit.request(issueUrl) as any as ReturnType<typeof context.octokit.issues.get>)
  const body = issue.data.body

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

      await startWorkflow(context, headRepo.owner.login, headRepo.name, headBranch, headSha, type, cloneRef, branch)
      return
    }
  }

  // Well, let's create a check run shall we?
  // await startWorkflow(context, repository.owner.login, repository.name, headBranch, headSha, type)

  await startWorkflow(context, headRepo.owner.login, headRepo.name, headBranch, headSha, type)
}

async function restartWorkflow(context: ContextType, checkRun: Context<'check_run.rerequested'>['payload']['check_run']): Promise<void> {
  const summary = checkRun.output?.summary
  if (!summary) {
    console.log('No summary')
    return
  }

  const metadataArr = summary.match(rerunMetadataRegex)

  if (!metadataArr || metadata.length !== 1) {
    console.log('Invalid metadata', metadataArr?.length, metadataArr)
    return
  }

  const metadataString = metadataArr[0]
  let metadataObject: any
  try {
    metadataObject = JSON.parse(metadataString)
  }
  catch (error) {
    console.log(`Invalid metadata JSON: ${metadataString}. Error:\n${error}`)
    return
  }

  const parsedMetadata = rerunMetadataSchema.safeParse(metadataObject)
  if (parsedMetadata.success === false) {
    console.log('Invalid metadata (ZOD error)', parsedMetadata.error)
    return
  }

  const metadataValue = parsedMetadata.data
  console.log('Starting workflow from rerun', metadataValue)
  await context.octokit.checks.create({
    owner: mainRepoName,
    repo: metadataValue.repo_name,
    name: 'E2E tests',
    status: 'queued',
    head_sha: metadataValue.commit_sha,
    output: {
      summary: '',
      title: 'Starting E2E workflow',
    },
  })

  await context.octokit.actions.createWorkflowDispatch({
    owner: mainRepoName,
    repo: githubBotRepoName,
    workflow_id: 'test.yml',
    inputs: metadataObject, // We do not use the zod parsed data here, because zod changes the data A BIT
    ref: 'main',
  })
}

async function startWorkflow(
  context: ContextType,
  owner: string,
  repo: string,
  branch: string,
  sha256: string,
  currentRepo: 'capgo' | 'cli',
  secondRepo?: string,
  secondRepoBranch?: string,
  testsToRun = 'all',
) {
  console.log('Starting workflow', owner, repo, branch, sha256, currentRepo, testsToRun)
  await context.octokit.checks.create({
    owner: mainRepoName,
    repo: currentRepo === 'capgo' ? 'capgo' : 'CLI',
    name: 'E2E tests',
    status: 'queued',
    head_sha: sha256,
    output: {
      summary: '',
      title: 'Starting E2E workflow',
    },
  })

  const firstRepoRef = `${owner}/${repo}`
  const secondRepoRef = (secondRepo && secondRepoBranch) ? secondRepo : undefined

  await context.octokit.actions.createWorkflowDispatch({
    owner: mainRepoName,
    repo: githubBotRepoName,
    workflow_id: 'test.yml',
    inputs: {
      capgo_clone_url: currentRepo === 'capgo' ? firstRepoRef : (secondRepoRef ?? defaultCapgoCloneRef),
      capgo_clone_branch: currentRepo === 'capgo' ? branch : defaultBranch,
      cli_clone_url: currentRepo === 'cli' ? firstRepoRef : (secondRepoRef ?? defaultCliCloneRef),
      cli_clone_branch: currentRepo === 'cli' ? branch : defaultBranch,
      tests_to_run: testsToRun,
      commit_sha: sha256,
      repo_owner: mainRepoName,
      repo_name: currentRepo === 'capgo' ? 'capgo' : 'CLI',
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
