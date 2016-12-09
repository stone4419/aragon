import ClosableSection from '/client/tmpl/components/closableSection'
import StockWatcher from '/client/lib/ethereum/stocks'
import Company from '/client/lib/ethereum/deployed'

const Stocks = StockWatcher.Stocks

const tmpl = Template.Module_Ownership_IssueShares.extend([ClosableSection])

const issueStock = async (kind, value) => {
  const supportNeeded = 70
  console.log(kind)
  console.log(Stocks.findOne())
  console.log(Stocks.findOne({ index: +kind }).symbol)
  const description = `Voting to issue ${value} ${Stocks.findOne({ index: +kind }).symbol} stocks`
  const addr = EthAccounts.findOne().address
  const oneWeekFromNow = parseInt(+new Date() / 1000) + 24 * 3600 *7
  console.log(oneWeekFromNow)
  const voting = await IssueStockVoting.new(kind, value, supportNeeded, description, { from: addr, gas: 1000000 })
  return await Company.beginPoll(voting.address, oneWeekFromNow, { from: addr, gas: 100000 })
}

tmpl.onRendered(function () {
  this.$('.dropdown').dropdown()
  this.$('.form').form({
    onSuccess: async (e) => {
      e.preventDefault()
      await issueStock(this.$('input[name=kind]').val(), this.$('input[name=number]').val())
      this.$('.dimmer').trigger('finished', { state: 'success' })
      return false
    },
  })
})

tmpl.helpers({
  stocks: () => Stocks.find(),
})

tmpl.events({
  'success .dimmer': () => FlowRouter.go('/ownership'),
})
