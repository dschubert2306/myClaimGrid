import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface OpsStackProps extends cdk.StackProps {
  extractionFunction: lambda.IFunction;
  /** Receives alarm and budget mails. Passed as context at deploy time, never committed. */
  alertEmail?: string;
  budgetLimitUsd: number;
}

export class OpsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OpsStackProps) {
    super(scope, id, props);

    const alarm = new cloudwatch.Alarm(this, 'ExtractionErrors', {
      alarmDescription: 'The extraction Lambda failed. Check the logs for the claim ID.',
      metric: props.extractionFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (!props.alertEmail) {
      cdk.Annotations.of(this).addWarning(
        'No alertEmail context set: the extraction alarm has no notification and no AWS Budget is created.',
      );
      return;
    }

    const topic = new sns.Topic(this, 'AlertTopic', { displayName: 'myclaimgrid alerts' });
    topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));
    alarm.addAlarmAction(new actions.SnsAction(topic));

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'myclaimgrid-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.budgetLimitUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
        },
      ],
    });
  }
}
