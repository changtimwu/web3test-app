import * as React from 'react'

type InfoEntry = { [index: string]: string | number }
class EthInfo extends React.Component<{ ethinfo: InfoEntry }> {
    render() {
        let ethinfo = this.props.ethinfo
        return (
            <ul>
                {Object.keys(ethinfo).map((title, i) => <li key={i}>{title}:{ethinfo[title]}</li>)}
            </ul>
        )
    }
}
export { EthInfo, InfoEntry }