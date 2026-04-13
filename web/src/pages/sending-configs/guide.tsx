import { Alert, Space, Typography } from "antd";
import { useI18n } from "../../i18n";
import { RESEND_DOCS, sendingConfigsI18n } from "./shared";

const { Link } = Typography;

export function ResendSetupGuide() {
	const { t } = useI18n();

	return (
		<Alert
			type="info"
			showIcon
			title={t(sendingConfigsI18n.setupGuideTitle)}
			description={
				<Space orientation="vertical" size={8}>
					<span>{t(sendingConfigsI18n.setupGuideBody)}</span>
					<Space wrap>
						<Link href={RESEND_DOCS.domains} target="_blank" rel="noreferrer">
							{t(sendingConfigsI18n.docsDomain)}
						</Link>
						<Link
							href={RESEND_DOCS.cloudflareDns}
							target="_blank"
							rel="noreferrer"
						>
							{t(sendingConfigsI18n.docsCloudflare)}
						</Link>
						<Link href={RESEND_DOCS.apiKeys} target="_blank" rel="noreferrer">
							{t(sendingConfigsI18n.docsApiKeys)}
						</Link>
						<Link href={RESEND_DOCS.sendEmail} target="_blank" rel="noreferrer">
							{t(sendingConfigsI18n.docsSendEmail)}
						</Link>
						<Link
							href={RESEND_DOCS.verifyTroubleshooting}
							target="_blank"
							rel="noreferrer"
						>
							{t(sendingConfigsI18n.docsVerification)}
						</Link>
					</Space>
				</Space>
			}
		/>
	);
}
