import * as React from 'react'

interface Balance {
    address: string
    val: number
}

class Accounts extends React.Component<{ balances: Balance[] }> {
    render() {
        return (
            <ul>
                {this.props.balances.map((balance, i) => <li key={i}>{balance.address}:{balance.val}</li>)}
            </ul>
        )
    }
}
export { Balance, Accounts }