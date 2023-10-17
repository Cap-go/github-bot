/* eslint-disable no-console */
import type { Context, Probot } from 'probot'
import metadata from 'probot-metadata'

// import { endpoint } from '@octokit/endpoint'

// import { createAppAuth } from '@octokit/auth-app'

const testRegex = /\/test.*/gmi
const linkCliPrRegex = /\/linkpr.*/gmi

const defaultBranch = 'main'
const defaultCapgoCloneRef = 'Cap-go/capgo'
const defaultCliCloneRef = 'Cap-go/CLI'
// const githubBotRepo = 'Cap-go/github-bot'

interface testOptions {
  capgoCloneRef: string
  capgoBranch: string
  cliCloneRef: string
  cliBranch: string
}

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

    // cont a = endpoint(context.payload.issue.pull_request)
    // const requestWithAuth = request.defaults({
    //   request: {
    //     hook: auth.hook,
    //   },
    //   mediaType: {
    //     previews: ['machine-man'],
    //   },
    // })
    // await requestWithAuth('GET')

    // context.payload.issue.pull_request.url

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
    const found = body.match(testRegex)
    const foundLink = body.match(linkCliPrRegex)
    if (!found && !foundLink) {
      console.log(`No match found in ${body}`)
      return
    }

    if (found || foundLink) {
      const userId = context.payload.comment.user.id
      // 50914789 is the ID of WcaleNieWolny (https://github.com/WcaleNieWolny)
      // 4084527 is the ID of ridex (https://github.com/riderx)
      if (userId !== 50914789 && userId !== 4084527) {
        console.log('Insufficient permissions')
        const createCiCdRunComment = context.issue({
          body: 'Insufficient permissions to use this command, please refer to [contributing.md](https://github.com/Cap-go/capgo/blob/main/CONTRIBUTING.md)',
        })

        await context.octokit.issues.createComment(createCiCdRunComment)
        await reactWith(context, '-1')
        return
      }
    }

    if (found) {
      for (const match of found) {
        const currentPr = await (context.octokit.request(pullRequestUrl) as any as ReturnType<typeof context.octokit.pulls.get>)
        const currentPrCloneRef = currentPr.data.head.repo?.full_name
        const currentPrBranch = currentPr.data.head.ref

        if (!currentPrCloneRef || !currentPrBranch) {
          console.log('No clone URL or branch')
          return
        }

        console.log('Found', match, match.split(' '))
        const args = match.split(' ').slice(1, undefined)

        if (args.length < 1) {
          console.log('To little args')
          const createCiCdRunComment = context.issue({
            body: 'Invalid usage! Please supply the tests you want to run. (`/test cli or `/test all` for example)',
          })

          await context.octokit.issues.createComment(createCiCdRunComment)
          await reactWith(context, '-1')
          return
        }

        const testsToRun = args[0]
        const metadataUrl = await metadata(context as any).get('cli_pr')
        let metadataUrlString: string | undefined

        if (typeof metadataUrl === 'string')
          metadataUrlString = metadataUrl

        const urlString = args[1] ?? metadataUrlString
        let options: testOptions | undefined

        if (urlString !== undefined) {
          console.log('URL string', urlString)

          const parsedUrl = await parsePrUrl(urlString)
          if (!parsedUrl) {
            await reactWith(context, '-1')
            return
          }

          const pullRequest = await context.octokit.pulls.get({
            owner: parsedUrl.owner,
            repo: parsedUrl.repo,
            pull_number: parsedUrl.pullNumber,
          })

          // repo.full_name ("full_name": "octocat/Hello-World",)
          // head.ref ("ref": "new-topic",)
          const cloneRef = pullRequest.data.head.repo?.full_name
          const branch = pullRequest.data.head.ref
          console.log('Clone ref', cloneRef, branch)

          if (cloneRef === undefined) {
            console.log('No clone URL')
            return
          }

          if (type === 'capgo') {
            options = {
              capgoCloneRef: currentPrCloneRef,
              capgoBranch: currentPrBranch,
              cliCloneRef: cloneRef,
              cliBranch: branch,
            }
          }
          else {
            options = {
              capgoCloneRef: cloneRef,
              capgoBranch: branch,
              cliCloneRef: currentPrCloneRef,
              cliBranch: currentPrBranch,
            }
          }
        }
        else {
          if (type === 'capgo') {
            options = {
              capgoCloneRef: currentPrCloneRef,
              capgoBranch: currentPrBranch,
              cliCloneRef: defaultCliCloneRef,
              cliBranch: defaultBranch,
            }
          }
          else {
            options = {
              capgoCloneRef: defaultCapgoCloneRef,
              capgoBranch: defaultBranch,
              cliCloneRef: currentPrCloneRef,
              cliBranch: currentPrBranch,
            }
          }
        }
        console.log('Options', options)
        console.log('Running', args)

        // Get the latest commit
        const sha256 = currentPr.data.head.sha
        const owner = currentPr.data.head.user.login
        const repo = currentPr.data.head.repo?.name
        if (!repo) {
          console.log('No repo')
          return
        }

        await startWorkflow(context, owner, repo, sha256, testsToRun)
      }
    }
    else if (foundLink) {
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

  app.on('check_suite.requested', async (context: Context<'check_suite.requested'>) => {
    const pullRequest = context.payload.check_suite.pull_requests
    if (pullRequest.length === 0 || context.payload.check_suite.head_branch === null) {
      console.log('No pull request or branch (perhaps a fork?)')
      return
    }

    const repository = context.payload.repository

    // Well, let's create a check run shall we?
    startWorkflow(context, repository.owner.login, repository.name, context.payload.check_suite.head_sha)
  })
}

async function startWorkflow(
  context: Context<'check_suite.requested'> | Context<'issue_comment'>,
  owner: string,
  repo: string,
  sha256: string,
  testsToRun = 'all',
) {
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
    owner: 'WcaleNieWolny',
    repo: 'temp-capgo-cicd',
    workflow_id: 'test_cli.yml',
    inputs: {
      capgo_clone_url: defaultCapgoCloneRef,
      capgo_clone_branch: 'main',
      cli_clone_url: defaultCapgoCloneRef,
      cli_clone_branch: 'main',
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
