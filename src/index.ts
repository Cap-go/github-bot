/* eslint-disable no-console */
import type { Context, Probot } from 'probot'

// import { endpoint } from '@octokit/endpoint'

// import { createAppAuth } from '@octokit/auth-app'

const testCliRegex = /\/testCli.*/gmi

const defaultBranch = 'main'
const defaultCapgoCloneUrl = 'https://github.com/WcaleNieWolny/capgo'
const defaultCliCloneUrl = 'https://github.com/WcaleNieWolny/CLI.git'

interface testOptions {
  capgoCloneUrl: string
  capgoBranch: string
  cliCloneUrl: string
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

    const currentPr = await (context.octokit.request(pullRequestUrl) as any as ReturnType<typeof context.octokit.pulls.get>)
    const currentPrCloneUrl = currentPr.data.head.repo?.clone_url
    const currentPrBranch = currentPr.data.head.ref

    if (!currentPrCloneUrl || !currentPrBranch) {
      console.log('No clone URL or branch')
      return
    }

    console.log('Response', currentPr)

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

    if (context.payload.issue.user.type === 'Bot')
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
      console.log('Not a capgo or CLI repository')
      return
    }

    console.log('type', type)

    const body = context.payload.comment.body
    const found = body.match(testCliRegex)
    if (!found) {
      console.log(`No match found in ${body}`)
      return
    }

    context.pullRequest({
      body,
    })

    for (const match of found) {
      console.log('Found', match, match.split(' '))
      const args = match.split(' ').slice(1, undefined)

      const urlString = args[0]
      let options: testOptions | undefined

      if (urlString !== undefined) {
        console.log('URL string', urlString)
        let url: URL | undefined
        try {
          url = new URL(urlString)
        }
        catch (error) {
          console.log('Invalid URL', urlString)
          return
        }

        console.log('URL', url)
        if (url.hostname !== 'github.com') {
          console.log('Invalid hostname', url.hostname)
          return
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
          return
        }

        const pullRequest = await context.octokit.pulls.get({
          owner,
          repo,
          pull_number: pullNumber,
        })

        const cloneUrl = pullRequest.data.head.repo?.clone_url
        const branch = pullRequest.data.head.ref
        console.log('Clone URL', cloneUrl, branch)

        if (cloneUrl === undefined) {
          console.log('No clone URL')
          return
        }

        if (type === 'capgo') {
          options = {
            capgoCloneUrl: currentPrCloneUrl,
            capgoBranch: currentPrBranch,
            cliCloneUrl: cloneUrl,
            cliBranch: branch,
          }
        }
        else {
          options = {
            capgoCloneUrl: cloneUrl,
            capgoBranch: branch,
            cliCloneUrl: currentPrCloneUrl,
            cliBranch: currentPrBranch,
          }
        }
      }
      else {
        if (type === 'capgo') {
          options = {
            capgoCloneUrl: currentPrCloneUrl,
            capgoBranch: currentPrBranch,
            cliCloneUrl: defaultCliCloneUrl,
            cliBranch: defaultBranch,
          }
        }
        else {
          options = {
            capgoCloneUrl: defaultCapgoCloneUrl,
            capgoBranch: defaultBranch,
            cliCloneUrl: currentPrCloneUrl,
            cliBranch: currentPrBranch,
          }
        }
      }
      console.log('Options', options)
      console.log('Running', args)
    }

    // const issueComment = context.issue({
    //   body: 'Thanks for testing this!',
    // })
    // await context.octokit.issues.createComment(issueComment)
  })
}
