/* eslint-disable no-console */
import type { Context, Probot } from 'probot'

const testCliRegex = /\/testCli.*/gmi

export default (app: Probot) => {
  app.on('issue_comment', async (context: Context<'issue_comment'>) => {
    if (context.payload.action === 'deleted')
      return

    if (context.payload.issue.pull_request === undefined) {
      console.log('Not a pull request')
      return
    }

    if (context.payload.issue.user.type === 'Bot')
      return

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
      }
      console.log('Running', args)
    }

    // const issueComment = context.issue({
    //   body: 'Thanks for testing this!',
    // })
    // await context.octokit.issues.createComment(issueComment)
  })
}
