import React from 'react'
import createHistory from 'history/createHashHistory'
import { contractAddresses, web3Providers } from './environment'
import { parsePath } from './routing'
import initWrapper, {
  initDaoBuilder,
  pollMainAccount,
  pollNetwork,
  pollConnectivity,
} from './aragonjs-wrapper'
import Wrapper from './Wrapper'
import Onboarding from './onboarding/Onboarding'
import { getWeb3, getUnknownBalance, identifyProvider } from './web3-utils'
import { log } from './utils'
import { PermissionsProvider } from './contexts/PermissionsContext'
import { FavoriteDaosProvider } from './contexts/FavoriteDaosContext'
import { ModalProvider } from './components/ModalManager/ModalManager'
import DeprecatedBanner from './components/DeprecatedBanner/DeprecatedBanner'
import { IdentityProvider } from './components/IdentityManager/IdentityManager'
import { CustomLabelModalProvider } from './components/CustomLabelModal/CustomLabelModalManager'
import CustomLabelModal from './components/CustomLabelModal/CustomLabelModal'
import {
  APPS_STATUS_ERROR,
  APPS_STATUS_READY,
  APPS_STATUS_LOADING,
  DAO_CREATION_STATUS_NONE,
  DAO_CREATION_STATUS_SUCCESS,
  DAO_CREATION_STATUS_ERROR,
} from './symbols'

class App extends React.Component {
  state = {
    account: '',
    apps: [],
    appsStatus: APPS_STATUS_LOADING,
    balance: getUnknownBalance(),
    buildData: null, // data returned by aragon.js when a DAO is created
    connected: false,
    daoAddress: { address: '', domain: '' },
    // daoCreationStatus is one of:
    //  - DAO_CREATION_STATUS_NONE
    //  - DAO_CREATION_STATUS_SUCCESS
    //  - DAO_CREATION_STATUS_ERROR
    daoCreationStatus: DAO_CREATION_STATUS_NONE,
    fatalError: null,
    identityIntent: null,
    locator: {},
    permissions: {},
    permissionsLoading: true,
    prevLocator: null,
    selectorNetworks: [
      ['main', 'Ethereum Mainnet', 'https://mainnet.aragon.org/'],
      ['rinkeby', 'Ethereum Testnet (Rinkeby)', 'https://rinkeby.aragon.org/'],
    ],
    showDeprecatedBanner: false,
    transactionBag: null,
    walletNetwork: '',
    walletWeb3: null,
    wrapper: null,
  }

  history = createHistory()

  componentDidMount() {
    const { pathname, search } = this.history.location
    this.handleHistoryChange({ pathname, search })
    this.history.listen(this.handleHistoryChange)

    this.setState({
      walletWeb3: getWeb3(web3Providers.wallet),
      walletProviderId: identifyProvider(web3Providers.wallet),
    })

    pollMainAccount(web3Providers.wallet, {
      onAccount: (account = null) => {
        this.setState({ account })
        if (account && this.state.wrapper) {
          this.state.wrapper.setAccounts([account])
        }
      },
      onBalance: balance => {
        this.setState({ balance })
      },
    })

    pollNetwork(web3Providers.wallet, walletNetwork => {
      this.setState({ walletNetwork })
    })

    // Only the default, because the app can work without the wallet
    pollConnectivity([web3Providers.default], connected => {
      this.setState({ connected })
    })
  }

  // Enable the web3 provider. There is no way to reliably know the enabled
  // state of a provider, so we assume that if there is a provider but no
  // account, the provider is locked and / or not enabled.
  handleRequestEnable = () => {
    const provider = web3Providers.wallet
    if (!provider) {
      return
    }
    // For providers supporting .enable() (EIP 1102 draft).
    if (typeof provider.enable === 'function') {
      provider.enable()
      return
    }
    // For providers supporting EIP 1102 (final).
    if (typeof provider.send === 'function') {
      // Some providers (Metamask) don’t return a promise as defined in EIP
      // 1102, so we can’t rely on it to know the connected accounts.
      provider.send('eth_requestAccounts')
    }
  }

  // Handle URL changes
  handleHistoryChange = ({ pathname, search }) => {
    this.updateLocator(parsePath(pathname, search))
  }

  // Change the URL if needed
  historyPush = path => {
    if (path !== this.state.locator.path) {
      this.history.push(path)
    }
  }

  // Change the URL to the previous one
  historyBack = () => {
    if (this.state.prevLocator) {
      this.history.goBack()
    } else {
      this.history.replace('/')
    }
  }

  updateLocator = locator => {
    const { locator: prevLocator } = this.state

    if (locator.mode === 'home' || locator.mode === 'setup') {
      this.updateDaoBuilder()
    }

    // New DAO: need to reinit the wrapper
    if (locator.dao && (!prevLocator || locator.dao !== prevLocator.dao)) {
      this.updateDao(locator.dao)
    }

    // Moving from a DAO to somewhere else (like onboarding):
    // need to cancel the subscribtions.
    if (!locator.dao && prevLocator && prevLocator.dao) {
      this.updateDao(null)
    }

    this.setState({ locator, prevLocator })
  }

  async updateDaoBuilder() {
    const daoBuilder = initDaoBuilder(
      web3Providers.wallet,
      contractAddresses.ensRegistry
    )
    this.setState({ daoBuilder })
  }

  handleResetDaoBuilder = () => {
    this.setState({
      daoCreationStatus: DAO_CREATION_STATUS_NONE,
      buildData: null,
    })
  }

  handleBuildDao = async (templateName, organizationName, data) => {
    const { daoBuilder } = this.state
    try {
      const [token, dao] = await daoBuilder.build(
        templateName,
        organizationName,
        data
      )
      const domain = `${organizationName}.aragonid.eth`
      this.setState({
        daoCreationStatus: DAO_CREATION_STATUS_SUCCESS,
        buildData: { token, dao, domain },
      })
      log('DAO created', dao, token, domain)
    } catch (err) {
      log(err)
      this.setState({ daoCreationStatus: DAO_CREATION_STATUS_ERROR })
    }
  }

  updateDao(dao = null) {
    // Cancel the subscriptions / unload the wrapper
    if (dao === null && this.state.wrapper) {
      this.state.wrapper.cancel()
      this.setState({ wrapper: null })
      return
    }

    // Reset the DAO state
    this.setState({
      appsStatus: APPS_STATUS_LOADING,
      apps: [],
      daoAddress: { address: '', domain: '' },
    })

    log('Init DAO', dao)
    initWrapper(dao, contractAddresses.ensRegistry, {
      provider: web3Providers.default,
      walletProvider: web3Providers.wallet,
      onError: err => {
        log(`Wrapper init, recoverable error: ${err.name}. ${err.message}.`)
        this.setState({ appsStatus: APPS_STATUS_ERROR })
      },
      onDaoAddress: ({ address, domain }) => {
        log('dao address', address)
        log('dao domain', domain)
        this.setState({ daoAddress: { address, domain } })
      },
      onWeb3: web3 => {
        log('web3', web3)
      },
      onApps: apps => {
        log('apps updated', apps)
        this.setState({
          apps,
          appsStatus: APPS_STATUS_READY,
        })
      },
      onPermissions: permissions => {
        log('permissions updated', permissions)
        this.setState({
          permissions,
          permissionsLoading: false,
        })
      },
      onForwarders: forwarders => {
        log('forwarders', forwarders)
      },
      onTransaction: transactionBag => {
        log('transaction bag', transactionBag)
        this.setState({ transactionBag })
      },
      onIdentityIntent: identityIntent => {
        console.log('onIdentityIntent: ', identityIntent)
        // callback for both iframe and native apps
        if (identityIntent.providerName === 'local') {
          // set the state for modifying a specific address identity
          this.setState({ identityIntent })
        }
      },
    })
      .then(wrapper => {
        log('wrapper', wrapper)
        this.setState({ wrapper })
        return wrapper
      })
      .catch(err => {
        log(`Wrapper init, fatal error: ${err.name}. ${err.message}.`)
        this.setState({ fatalError: err })
      })
  }

  handleRequestAppsReload = () => {
    this.setState({ appsStatus: APPS_STATUS_LOADING, apps: [] })
    clearTimeout(this._requestAppsTimer)
    this._requestAppsTimer = setTimeout(() => {
      this.updateDao(this.state.locator.dao)
    }, 1000)
  }

  handleIdentityCancel = () => {
    this.setState({ identityIntent: null })
  }

  handleIdentitySave = ({ address, label }) => {
    const { resolve, reject } = this.state.identityIntent
    this.state.wrapper
      .modifyAddressIdentity(address, { name: label })
      .then(() => this.setState({ identityIntent: null }, resolve))
      .catch(reject)
  }

  handleIdentityResolve = address => {
    // returns promise
    console.log('handleIdentityResolve')
    if (this.state.wrapper) {
      return this.state.wrapper.resolveAddressIdentity(address)
    }
    return Promise.reject(new Error('Wrapper not initialised yet'))
  }

  handleCompleteOnboarding = () => {
    const { domain } = this.state.buildData
    this.historyPush(`/${domain}`)
  }
  handleOpenOrganization = address => {
    this.historyPush(`/${address}`)
  }
  handleOpenCustomLabelModal = address => {
    console.log('handleOpenCustomLabelModal: ', address)
    return this.state.wrapper.requestAddressIdentityModification(address)
  }

  render() {
    const {
      account,
      apps,
      appsStatus,
      balance,
      connected,
      daoAddress,
      daoCreationStatus,
      fatalError,
      identityIntent,
      locator,
      permissions,
      permissionsLoading,
      selectorNetworks,
      showDeprecatedBanner,
      transactionBag,
      walletNetwork,
      walletProviderId,
      walletWeb3,
      wrapper,
    } = this.state

    const { mode, dao } = locator
    if (!mode) return null
    if (mode === 'invalid') {
      throw new Error(
        `URL contained invalid organization name or address (${dao}).\nPlease modify it to be a valid ENS name or address.`
      )
    }

    if (fatalError !== null) {
      throw fatalError
    }
    const { address: identityAddress = null, label: identityLabel = '' } =
      identityIntent || {}

    return (
      <IdentityProvider onResolve={this.handleIdentityResolve}>
        <ModalProvider>
          <CustomLabelModalProvider
            onShowCustomLabelModal={this.handleOpenCustomLabelModal}
          >
            <CustomLabelModal
              address={identityAddress}
              label={identityLabel}
              opened={identityIntent !== null}
              onCancel={this.handleIdentityCancel}
              onSave={this.handleIdentitySave}
            />
            <FavoriteDaosProvider>
              <PermissionsProvider
                wrapper={wrapper}
                apps={apps}
                permissions={permissions}
              >
                <Wrapper
                  account={account}
                  apps={apps}
                  appsStatus={appsStatus}
                  banner={
                    showDeprecatedBanner && <DeprecatedBanner dao={dao} />
                  }
                  connected={connected}
                  daoAddress={daoAddress}
                  historyBack={this.historyBack}
                  historyPush={this.historyPush}
                  identityIntent={identityIntent}
                  locator={locator}
                  onRequestAppsReload={this.handleRequestAppsReload}
                  onRequestEnable={this.handleRequestEnable}
                  permissionsLoading={permissionsLoading}
                  transactionBag={transactionBag}
                  walletNetwork={walletNetwork}
                  walletWeb3={walletWeb3}
                  wrapper={wrapper}
                />
              </PermissionsProvider>

              <Onboarding
                banner={
                  showDeprecatedBanner && (
                    <DeprecatedBanner dao={dao} lightMode />
                  )
                }
                visible={mode === 'home' || mode === 'setup'}
                account={account}
                balance={balance}
                walletNetwork={walletNetwork}
                walletProviderId={walletProviderId}
                onBuildDao={this.handleBuildDao}
                daoCreationStatus={daoCreationStatus}
                onComplete={this.handleCompleteOnboarding}
                onOpenOrganization={this.handleOpenOrganization}
                onRequestEnable={this.handleRequestEnable}
                onResetDaoBuilder={this.handleResetDaoBuilder}
                selectorNetworks={selectorNetworks}
              />
            </FavoriteDaosProvider>
          </CustomLabelModalProvider>
        </ModalProvider>
      </IdentityProvider>
    )
  }
}

export default App
